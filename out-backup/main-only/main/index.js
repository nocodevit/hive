"use strict";
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const pty = require("node-pty");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const pty__namespace = /* @__PURE__ */ _interopNamespaceDefault(pty);
const is = {
  dev: !electron.app.isPackaged
};
const platform = {
  isWindows: process.platform === "win32",
  isMacOS: process.platform === "darwin",
  isLinux: process.platform === "linux"
};
const electronApp = {
  setAppUserModelId(id) {
    if (platform.isWindows)
      electron.app.setAppUserModelId(is.dev ? process.execPath : id);
  },
  setAutoLaunch(auto) {
    if (platform.isLinux)
      return false;
    const isOpenAtLogin = () => {
      return electron.app.getLoginItemSettings().openAtLogin;
    };
    if (isOpenAtLogin() !== auto) {
      electron.app.setLoginItemSettings({
        openAtLogin: auto,
        path: process.execPath
      });
      return isOpenAtLogin() === auto;
    } else {
      return true;
    }
  },
  skipProxy() {
    return electron.session.defaultSession.setProxy({ mode: "direct" });
  }
};
const optimizer = {
  watchWindowShortcuts(window, shortcutOptions) {
    if (!window)
      return;
    const { webContents } = window;
    const { escToCloseWindow = false, zoom = false } = shortcutOptions || {};
    webContents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown") {
        if (!is.dev) {
          if (input.code === "KeyR" && (input.control || input.meta))
            event.preventDefault();
        } else {
          if (input.code === "F12") {
            if (webContents.isDevToolsOpened()) {
              webContents.closeDevTools();
            } else {
              webContents.openDevTools({ mode: "undocked" });
              console.log("Open dev tool...");
            }
          }
        }
        if (escToCloseWindow) {
          if (input.code === "Escape" && input.key !== "Process") {
            window.close();
            event.preventDefault();
          }
        }
        if (!zoom) {
          if (input.code === "Minus" && (input.control || input.meta))
            event.preventDefault();
          if (input.code === "Equal" && input.shift && (input.control || input.meta))
            event.preventDefault();
        }
      }
    });
  },
  registerFramelessWindowIpc() {
    electron.ipcMain.on("win:invoke", (event, action) => {
      const win = electron.BrowserWindow.fromWebContents(event.sender);
      if (win) {
        if (action === "show") {
          win.show();
        } else if (action === "showInactive") {
          win.showInactive();
        } else if (action === "min") {
          win.minimize();
        } else if (action === "max") {
          const isMaximized = win.isMaximized();
          if (isMaximized) {
            win.unmaximize();
          } else {
            win.maximize();
          }
        } else if (action === "close") {
          win.close();
        }
      }
    });
  }
};
const DATA_DIR = path.join(electron.app.getPath("home"), ".hive");
const DATA_FILE = path.join(DATA_DIR, "data.json");
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function loadData() {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) return { projects: [], agents: [] };
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
}
function saveData(data) {
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
const terminals = /* @__PURE__ */ new Map();
const HIVE_PORT = parseInt(process.env.HIVE_PORT || "17710", 10);
const LOGS_DIR = path.join(electron.app.getPath("home"), ".hive", "logs");
function appendLog(agentId, entry) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const logFile = path.join(LOGS_DIR, `${agentId}.json`);
  let logs = [];
  try {
    if (fs.existsSync(logFile)) logs = JSON.parse(fs.readFileSync(logFile, "utf-8"));
  } catch {
  }
  logs.push(entry);
  let maxLogs = 100;
  try {
    const d = loadData();
    if (d.appPrefs?.maxLogs) maxLogs = d.appPrefs.maxLogs;
  } catch {
  }
  if (logs.length > maxLogs) logs = logs.slice(-maxLogs);
  fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
}
function loadLogs(agentId) {
  const logFile = path.join(LOGS_DIR, `${agentId}.json`);
  try {
    if (fs.existsSync(logFile)) return JSON.parse(fs.readFileSync(logFile, "utf-8"));
  } catch {
  }
  return [];
}
const lastAgentStatus = /* @__PURE__ */ new Map();
const statusServer = http.createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(404);
    res.end();
    return;
  }
  let body = "";
  req.on("data", (chunk) => body += chunk);
  req.on("end", () => {
    try {
      const data = JSON.parse(body);
      const win = electron.BrowserWindow.getAllWindows()[0];
      const now = (/* @__PURE__ */ new Date()).toISOString();
      if (req.url === "/status") {
        const prev = lastAgentStatus.get(data.agentId);
        if (prev !== data.status) {
          lastAgentStatus.set(data.agentId, data.status);
          appendLog(data.agentId, { time: now, type: "status", message: data.status });
        }
        if (win && !win.isDestroyed()) win.webContents.send("agent:status", data);
      } else if (req.url === "/report") {
        if (data.type === "task_start") {
          appendLog(data.agentId, { time: now, type: "task_start", message: data.title || "Task started" });
        } else if (data.type === "task_done") {
          appendLog(data.agentId, { time: now, type: "task_done", message: data.summary || "Task completed" });
        } else if (data.type === "notification") {
          appendLog(data.agentId, { time: now, type: "notification", message: data.message || "" });
        } else {
          appendLog(data.agentId, { time: now, type: "report", message: JSON.stringify(data.items || data) });
        }
        if (win && !win.isDestroyed()) win.webContents.send("agent:report", data);
      }
      res.writeHead(200);
      res.end("ok");
    } catch {
      res.writeHead(400);
      res.end("bad request");
    }
  });
});
function writeAgentDefinition(cwd, config) {
  const agentsDir = path.join(cwd, ".claude", "agents");
  fs.mkdirSync(agentsDir, { recursive: true });
  const agentName = `hive-${config.agentId}`;
  const curlCmd = (endpoint, jsonBody) => `curl -s -X POST http://127.0.0.1:${HIVE_PORT}${endpoint} -H "Content-Type: application/json" -d '${jsonBody}' > /dev/null 2>&1`;
  const yamlHookBlock = (event, cmd) => `  ${event}:
    - matcher: ""
      hooks:
        - type: command
          command: >-
            ${cmd}
`;
  let yaml = `---
`;
  yaml += `name: ${agentName}
`;
  yaml += `description: "${config.name} - ${config.role} specialist"
`;
  yaml += `model: ${config.model || "inherit"}
`;
  yaml += `effort: ${config.effort || "high"}
`;
  if (config.skills.length > 0) {
    yaml += `skills:
${config.skills.map((s) => `  - ${s}`).join("\n")}
`;
  }
  yaml += `hooks:
`;
  yaml += yamlHookBlock("PreToolUse", curlCmd("/status", `{"agentId":"${config.agentId}","status":"working"}`));
  yaml += yamlHookBlock("Stop", curlCmd("/status", `{"agentId":"${config.agentId}","status":"waiting"}`));
  yaml += `---

`;
  yaml += config.soul;
  yaml += `

## Task Reporting
When you start a new task, run: \`.claude/hive-report.sh start "task title"\`
When you finish a task, run: \`.claude/hive-report.sh done "summary"\`
`;
  fs.writeFileSync(path.join(agentsDir, `${agentName}.md`), yaml);
  const memoryDir = path.join(electron.app.getPath("home"), ".hive", "memory", config.agentId);
  fs.mkdirSync(memoryDir, { recursive: true });
  const cwdMemory = path.join(cwd, ".claude", "memory");
  try {
    const s = fs.lstatSync(cwdMemory);
    if (s.isSymbolicLink()) fs.unlinkSync(cwdMemory);
  } catch {
  }
  if (!fs.existsSync(cwdMemory)) {
    fs.symlinkSync(memoryDir, cwdMemory);
  }
  const reportScript = path.join(cwd, ".claude", "hive-report.sh");
  fs.writeFileSync(reportScript, `#!/bin/bash
ACTION="$1"; MSG="$2"; AGENT="${config.agentId}"; PORT=${HIVE_PORT}
case "$ACTION" in
  start) curl -s -X POST http://127.0.0.1:$PORT/report -H "Content-Type: application/json" -d "{\\"agentId\\":\\"$AGENT\\",\\"type\\":\\"task_start\\",\\"title\\":\\"$MSG\\"}" > /dev/null 2>&1 ;;
  done) curl -s -X POST http://127.0.0.1:$PORT/report -H "Content-Type: application/json" -d "{\\"agentId\\":\\"$AGENT\\",\\"type\\":\\"task_done\\",\\"summary\\":\\"$MSG\\"}" > /dev/null 2>&1 ;;
esac
`, { mode: 493 });
  return agentName;
}
function createWindow() {
  const mainWindow = new electron.BrowserWindow({
    title: "Hive",
    width: 1400,
    height: 900,
    show: false,
    icon: path.join(__dirname, "../../resources/icon.png"),
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 15, y: 10 },
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
    if (is.dev) mainWindow.webContents.openDevTools({ mode: "bottom" });
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
electron.ipcMain.handle("pty:create", (_event, { id, cwd }) => {
  try {
    const userShell = process.env.SHELL || "/bin/zsh";
    const term = pty__namespace.spawn(userShell, ["-l"], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: cwd || process.env.HOME || "/tmp",
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor"
      }
    });
    terminals.set(id, term);
    term.onData((data) => {
      const win = electron.BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        win.webContents.send(`pty:data:${id}`, data);
      }
    });
    term.onExit(({ exitCode }) => {
      terminals.delete(id);
      const win = electron.BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        win.webContents.send(`pty:exit:${id}`, exitCode);
      }
    });
    return { pid: term.pid };
  } catch (err) {
    console.error("PTY create error:", err);
    return { pid: -1, error: String(err) };
  }
});
electron.ipcMain.handle("pty:write", (_event, { id, data }) => {
  const term = terminals.get(id);
  if (term) term.write(data);
});
electron.ipcMain.handle("pty:resize", (_event, { id, cols, rows }) => {
  const term = terminals.get(id);
  if (term) term.resize(cols, rows);
});
electron.ipcMain.handle("pty:kill", (_event, { id }) => {
  const term = terminals.get(id);
  if (term) {
    term.kill();
    terminals.delete(id);
  }
});
electron.ipcMain.handle("dialog:selectFolder", async (_event, { title }) => {
  const result = await electron.dialog.showOpenDialog({
    title: title || "Select Folder",
    properties: ["openDirectory"]
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});
electron.ipcMain.handle("data:load", () => loadData());
electron.ipcMain.handle("data:save", (_event, data) => {
  saveData(data);
  return true;
});
electron.ipcMain.handle("fs:hasGit", (_event, { path: path$1 }) => {
  return fs.existsSync(path.join(path$1, ".git"));
});
electron.ipcMain.handle("git:worktreeAdd", (_event, { repoPath, agentId, agentName }) => {
  try {
    const { execSync } = require("child_process");
    const safeName = agentName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const branchName = `hive/${safeName}-${agentId.slice(-6)}`;
    const worktreePath = path.join(repoPath, "..", `${repoPath.split("/").pop()}-${safeName}`);
    try {
      execSync(`git -C "${repoPath}" branch "${branchName}"`, { encoding: "utf-8", stdio: "pipe" });
    } catch {
    }
    execSync(`git -C "${repoPath}" worktree add "${worktreePath}" "${branchName}"`, { encoding: "utf-8", stdio: "pipe" });
    return { ok: true, path: worktreePath, branch: branchName };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});
electron.ipcMain.handle("git:worktreeRemove", (_event, { repoPath, worktreePath }) => {
  try {
    const { execSync } = require("child_process");
    execSync(`git -C "${repoPath}" worktree remove "${worktreePath}" --force`, { encoding: "utf-8", stdio: "pipe" });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});
electron.ipcMain.handle("git:worktreeList", (_event, { repoPath }) => {
  try {
    const { execSync } = require("child_process");
    const output = execSync(`git -C "${repoPath}" worktree list --porcelain`, { encoding: "utf-8" });
    const worktrees = output.split("\n\n").filter(Boolean).map((block) => {
      const lines = block.split("\n");
      const path2 = lines.find((l) => l.startsWith("worktree "))?.slice(9) || "";
      const branch = lines.find((l) => l.startsWith("branch "))?.slice(7) || "";
      return { path: path2, branch };
    });
    return worktrees;
  } catch {
    return [];
  }
});
electron.ipcMain.handle("project:scan", (_event, { zones }) => {
  const todos = [];
  let projectStage = "early-stage";
  for (const zone of zones) {
    if (!fs.existsSync(zone.path)) continue;
    if (zone.type === "rnd") {
      try {
        const { execSync } = require("child_process");
        const log = execSync(`git -C "${zone.path}" log --oneline -20 --since="30 days ago" 2>/dev/null`, { encoding: "utf-8" });
        const commitCount = log.trim().split("\n").filter(Boolean).length;
        if (commitCount > 10) projectStage = "active";
        else if (commitCount > 0) projectStage = "incubating";
        const hasCI = fs.existsSync(path.join(zone.path, ".github/workflows")) || fs.existsSync(path.join(zone.path, ".gitlab-ci.yml")) || fs.existsSync(path.join(zone.path, "vercel.json")) || fs.existsSync(path.join(zone.path, "netlify.toml"));
        if (hasCI && commitCount > 10) projectStage = "active-online";
      } catch {
      }
    }
    try {
      const scanDir = (dir, depth) => {
        if (depth > 3) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "vendor" || entry.name === "dist" || entry.name === "build" || entry.name === "out") continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory() && depth < 3) {
            scanDir(fullPath, depth + 1);
          } else if (entry.isFile() && /\.(md|txt)$/i.test(entry.name)) {
            try {
              const content = fs.readFileSync(fullPath, "utf-8");
              const lines = content.split("\n");
              for (const line of lines) {
                const todoMatch = line.match(/^[\s]*[-*]\s*\[([ xX])\]\s+(.+)/);
                if (todoMatch) {
                  const done = todoMatch[1].toLowerCase() === "x";
                  const text = todoMatch[2].trim();
                  let category = "other";
                  const lower = text.toLowerCase();
                  if (lower.includes("market") || lower.includes("seo") || lower.includes("social") || lower.includes("content") || lower.includes("campaign")) {
                    category = "marketing";
                  } else if (lower.includes("monetiz") || lower.includes("pricing") || lower.includes("revenue") || lower.includes("payment") || lower.includes("subscri")) {
                    category = "monetizing";
                  } else if (lower.includes("bug") || lower.includes("fix") || lower.includes("test") || lower.includes("refactor") || lower.includes("feature") || lower.includes("implement")) {
                    category = "rd";
                  } else if (lower.includes("doc") || lower.includes("readme") || lower.includes("deploy") || lower.includes("ci") || lower.includes("setup")) {
                    category = "ops";
                  }
                  todos.push({
                    zone: zone.path.split("/").pop() || "",
                    type: zone.type,
                    category,
                    text,
                    done
                  });
                }
              }
            } catch {
            }
          }
        }
      };
      scanDir(zone.path, 0);
    } catch {
    }
  }
  return { projectStage, todos };
});
electron.ipcMain.handle("fs:scanFiles", (_event, { dirPath, limit = 100 }) => {
  const SKIP = /* @__PURE__ */ new Set(["node_modules", ".git", ".next", ".cache", ".hive", "__pycache__", ".DS_Store", ".Trash", ".Spotlight-V100", "dist", "build", "out"]);
  const files = [];
  function walk(dir, depth) {
    if (depth > 5 || files.length > limit * 2) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (SKIP.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        try {
          const st = fs.lstatSync(full);
          if (st.isSymbolicLink()) continue;
          if (st.isDirectory()) {
            walk(full, depth + 1);
          } else if (st.isFile()) {
            const rel = full.slice(dirPath.length + 1);
            files.push({ path: rel, mtime: st.mtimeMs, size: st.size });
          }
        } catch {
        }
      }
    } catch {
    }
  }
  if (fs.existsSync(dirPath)) walk(dirPath, 0);
  files.sort((a, b) => b.mtime - a.mtime);
  return files.slice(0, limit);
});
electron.ipcMain.handle("fs:revealInFinder", (_event, { filePath }) => {
  electron.shell.showItemInFolder(filePath);
});
const TEMPLATES_DIR = path.join(electron.app.getPath("home"), ".hive", "templates");
electron.ipcMain.handle("templates:list", () => {
  fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
  try {
    return fs.readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith(".json")).map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, f), "utf-8"));
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
});
electron.ipcMain.handle("templates:save", (_event, { template }) => {
  fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
  fs.writeFileSync(path.join(TEMPLATES_DIR, `${template.id}.json`), JSON.stringify(template, null, 2));
  return true;
});
electron.ipcMain.handle("templates:delete", (_event, { id }) => {
  const f = path.join(TEMPLATES_DIR, `${id}.json`);
  try {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  } catch {
  }
  return true;
});
electron.ipcMain.handle("fs:readFile", (_event, { filePath }) => {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
});
electron.ipcMain.handle("project:readClaudeMd", (_event, { projectPath }) => {
  const paths = [
    path.join(projectPath, "CLAUDE.md"),
    path.join(projectPath, ".claude", "CLAUDE.md")
  ];
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
    } catch {
    }
  }
  return null;
});
electron.ipcMain.handle("skills:readContent", (_event, { path: skillPath }) => {
  const skillMd = path.join(skillPath, "SKILL.md");
  try {
    if (fs.existsSync(skillMd)) return fs.readFileSync(skillMd, "utf-8");
  } catch {
  }
  return null;
});
electron.ipcMain.handle("agent:writeDefinition", (_event, { cwd, config }) => {
  try {
    const agentName = writeAgentDefinition(cwd, config);
    return { ok: true, agentName };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});
electron.ipcMain.handle("agent:deleteDefinition", (_event, { cwd, agentId }) => {
  const agentFile = path.join(cwd, ".claude", "agents", `hive-${agentId}.md`);
  try {
    if (fs.existsSync(agentFile)) fs.unlinkSync(agentFile);
  } catch {
  }
  return true;
});
electron.ipcMain.handle("agent:loadLogs", (_event, { agentId }) => {
  return loadLogs(agentId);
});
electron.ipcMain.handle("agent:clearLogs", (_event, { agentId }) => {
  const logFile = path.join(LOGS_DIR, `${agentId}.json`);
  try {
    fs.writeFileSync(logFile, "[]");
  } catch {
  }
  return true;
});
electron.ipcMain.handle("skills:scan", () => {
  const skillsDir = path.join(electron.app.getPath("home"), ".claude", "skills");
  if (!fs.existsSync(skillsDir)) return [];
  const skills = [];
  function parseSkillMd(filePath) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const nameMatch = content.match(/^name:\s*(.+)$/m);
      const descMatch = content.match(/description:\s*\|?\s*\n?\s*(.+)/m);
      if (!nameMatch) return null;
      return {
        name: nameMatch[1].trim(),
        description: (descMatch?.[1] || "").trim().slice(0, 120)
      };
    } catch {
      return null;
    }
  }
  try {
    const topEntries = fs.readdirSync(skillsDir, { withFileTypes: true });
    for (const top of topEntries) {
      if (!top.isDirectory()) continue;
      const topPath = path.join(skillsDir, top.name);
      const topSkill = path.join(topPath, "SKILL.md");
      let foundSub = false;
      try {
        const subEntries = fs.readdirSync(topPath, { withFileTypes: true });
        for (const sub of subEntries) {
          if (!sub.isDirectory()) continue;
          const subSkill = path.join(topPath, sub.name, "SKILL.md");
          if (fs.existsSync(subSkill)) {
            const parsed = parseSkillMd(subSkill);
            if (parsed) {
              skills.push({
                name: parsed.name,
                pack: top.name,
                path: path.join(topPath, sub.name),
                description: parsed.description
              });
              foundSub = true;
            }
          }
        }
      } catch {
      }
      if (!foundSub && fs.existsSync(topSkill)) {
        const parsed = parseSkillMd(topSkill);
        if (parsed) {
          skills.push({
            name: parsed.name,
            pack: top.name,
            path: topPath,
            description: parsed.description
          });
        }
      }
    }
  } catch {
  }
  return skills;
});
electron.app.whenReady().then(() => {
  electron.app.setName("Hive");
  electronApp.setAppUserModelId("com.hive.app");
  statusServer.listen(HIVE_PORT, "127.0.0.1", () => {
    console.log(`[Hive] Status server on http://127.0.0.1:${HIVE_PORT}`);
  });
  electron.app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  for (const [, term] of terminals) {
    term.kill();
  }
  terminals.clear();
  if (process.platform !== "darwin") electron.app.quit();
});
