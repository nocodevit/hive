"use strict";
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const pty = require("node-pty");
const child_process = require("child_process");
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
function tasksDir(dataDir, projectId) {
  return path.join(dataDir, "comms", projectId, "tasks");
}
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function taskFilePath(dataDir, projectId, taskId) {
  return path.join(tasksDir(dataDir, projectId), `${taskId}.json`);
}
function getNextId(dataDir, projectId) {
  const dir = tasksDir(dataDir, projectId);
  ensureDir(dir);
  const files = fs.readdirSync(dir).filter((f) => f.match(/^task-\d+\.json$/));
  if (files.length === 0) return "task-001";
  const nums = files.map((f) => parseInt(f.match(/task-(\d+)/)?.[1] || "0", 10));
  const next = Math.max(...nums) + 1;
  return `task-${String(next).padStart(3, "0")}`;
}
function createTask(dataDir, projectId, data) {
  const id = getNextId(dataDir, projectId);
  const task = { id, ...data };
  const dir = tasksDir(dataDir, projectId);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(task, null, 2));
  return task;
}
function readTask(dataDir, projectId, taskId) {
  const fp = taskFilePath(dataDir, projectId, taskId);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, "utf-8"));
}
function updateTask(dataDir, projectId, taskId, updates) {
  const task = readTask(dataDir, projectId, taskId);
  if (!task) return null;
  const updated = { ...task, ...updates, id: task.id };
  fs.writeFileSync(taskFilePath(dataDir, projectId, taskId), JSON.stringify(updated, null, 2));
  return updated;
}
function listTasks(dataDir, projectId) {
  const dir = tasksDir(dataDir, projectId);
  ensureDir(dir);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  return files.map((f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
    } catch {
      return null;
    }
  }).filter(Boolean);
}
function runCmd(cmd, cwd, timeout = 12e4) {
  try {
    const output = child_process.execSync(cmd, { cwd, timeout, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    return { ok: true, output: output.trim() };
  } catch (err) {
    return { ok: false, output: (err.stderr || err.stdout || err.message || "").toString().trim() };
  }
}
async function runGate(cwd, task) {
  const failures = [];
  if (task.scope && task.scope !== ".") {
    const diff = runCmd("git diff --name-only origin/main...HEAD", cwd);
    if (diff.ok && diff.output) {
      const files = diff.output.split("\n").filter(Boolean);
      const outside = files.filter((f) => !f.startsWith(task.scope));
      if (outside.length > 0) {
        failures.push({ step: "scope", detail: `Files outside scope "${task.scope}": ${outside.join(", ")}` });
      }
    }
  }
  for (const cmd of task.verify) {
    const result = runCmd(cmd, cwd, 3e4);
    if (!result.ok) {
      failures.push({ step: "verify", detail: `"${cmd}" failed: ${result.output.slice(0, 200)}` });
    }
  }
  return { pass: failures.length === 0, failures };
}
function getManagerSoulAddendum(config) {
  const reportSh = config.reportScriptPath || ".claude/hive-report.sh";
  const workerList = config.workers?.map((w) => `- ${w.id} (${w.name})`).join("\n") || "(none assigned)";
  return `

## Hive Orchestration — Manager

You are the manager of this task group. You coordinate workers, QA, and Critic.

### Project
Project ID: ${config.projectId || "unknown"}
IMPORTANT: Always use this exact projectId in task-create calls.

### Your Team
Workers (ONLY assign tasks to these agents):
${workerList}

QA: ${config.qaId || "TBD"} (${config.qaName || "TBD"})
Critic: ${config.criticId || "TBD"} (${config.criticName || "TBD"})

IMPORTANT: Only assign tasks to the worker agent IDs listed above. Do NOT assign tasks to other agents.

### Startup
When you receive instructions, follow them. Do NOT auto-start any skills.
1. Read the todo file when told the path
2. Parse items with metadata (depends, scope, verify, acceptance)
3. Group into batches: each batch has ZERO internal dependencies
4. Propose batch: \`${reportSh} batch-propose '{"batch":N,"tasks":[...]}'\`
5. Wait for human approval via [HIVE:HUMAN] {"batch":N,"action":"approved"}

### Execution
1. Create ALL tasks first: \`${reportSh} task-create '{"projectId":"...","title":"...","scope":"...","verify":[...],"depends":[],"batch":N,"estimatedMinutes":5}'\`
   estimatedMinutes: your estimate of how long a worker needs. The system alerts on timeout.
   Save each returned id (e.g. task-001, task-002...).
2. Assign ONLY one task per worker (first-finish-first-assign):
   \`${reportSh} task-assign task-001 WORKER_1_ID\`
   \`${reportSh} task-assign task-002 WORKER_2_ID\`
   Do NOT assign more tasks than available workers. Leave remaining tasks unassigned.
   The system will auto-assign the next pending task when a worker finishes.
3. Monitor: \`${reportSh} task-status\` (poll every 30s)
4. All done → merge worker branches → integration branch → trigger QA
5. QA pass → trigger Critic (delivery agent)
6. Critic done → report to human for merge

### On Blocked
- Worker blocked → decide: reassign or escalate
- All workers blocked → \`${reportSh} report-human "all workers blocked"\`
- QA fail → create fix tasks → mini-batch
- Re-read ${config.todoSource} periodically for new items

### Hive Messages
- [HIVE:HUMAN] — human decisions (batch approval, merge, feedback). Highest priority.
- [HIVE:MSG] — task status changes from workers/QA/Critic
`;
}
function getWorkerSoulAddendum(config) {
  const reportSh = config.reportScriptPath || ".claude/hive-report.sh";
  return `

## Hive Orchestration — Worker

### Task Execution
1. WAIT for [HIVE:TASK] message
2. Parse the JSON: note the id, title, scope
3. Execute the task (create the file, write the content)
4. As soon as you finish the task, IMMEDIATELY call:
   \`${reportSh} task-done TASK_ID "brief summary"\`
   Use the exact task id from the [HIVE:TASK] message (e.g. task-001).
   Do NOT wait, do NOT build/test, do NOT commit. Just call task-done.
5. The system runs gate verification automatically after task-done.
   If gate fails, you will receive [HIVE:MSG] {"gate":"failed",...} — then fix and call task-done again.
   After ${config.maxRetries} failures: \`${reportSh} task-blocked TASK_ID "reason"\`
2. Wait for [HIVE:MSG] {"ack":...}
3. Append lessons to .claude/lessons.md (max 5 lines per task)
4. \`${reportSh} ready\`
5. Type \`/clear\` to reset context
6. Wait for next [HIVE:TASK]

NEVER exit. NEVER work outside scope. NEVER push failing code.
If you receive [HIVE:HUMAN], follow that instruction immediately.
`;
}
function getQaSoulAddendum(config) {
  const reportSh = config?.reportScriptPath || ".claude/hive-report.sh";
  return `

## Hive Orchestration — QA

You run integration testing after a batch of tasks is complete.

1. WAIT for [HIVE:TASK] with type="qa"
2. Checkout the integration branch specified in the task
3. Run full test suite: \`npm test\`
4. Check test coverage if available
5. Run ALL contract verify[] commands from the task list
6. Produce test report at the path specified (markdown format):
   - Overall pass/fail, test count, coverage %
   - Each verify[] result (pass/fail)
   - Any regressions vs main
7. Report:
   - Pass: \`${reportSh} task-done QA_TASK "QA pass"\`
   - Fail: \`${reportSh} task-blocked QA_TASK "failures: [details]"\`

You NEVER fix code. Report only.
If you receive [HIVE:HUMAN], follow that instruction immediately.
`;
}
function getCriticSoulAddendum(config) {
  const reportSh = config?.reportScriptPath || ".claude/hive-report.sh";
  return `

## Hive Orchestration — Critic (Delivery Agent)

You ship the batch as a clean, verified PR. Use /review skill as foundation.

### Delivery Protocol
1. WAIT for [HIVE:TASK] with type="delivery"
2. Parse: branch name, QA report path, task list with verify[] items

### Step 1: Rebase
\`git checkout BRANCH && git fetch origin && git rebase origin/main\`
If conflicts: resolve. If unresolvable: report to manager.

### Step 2: Require QA Report (no duplicate testing)
QA already ran full build + test + coverage. Do NOT re-run them — that wastes time and tokens.
Read QA report at the specified path. If not found: REFUSE to proceed.
Verify it contains: pass/fail status, coverage, verify results.
If QA status is not pass: REFUSE to proceed — report to manager.

### Step 3: PR Review
Use /review skill. Focus on security, logic, scope creep, quality, test adequacy.

### Step 4: Create PR
\`gh pr create --base main --head BRANCH --title "..." --body "..."\`
Body must include: task list, test report summary, review findings, verify results.

### Step 5: Push & Report
\`git push origin BRANCH\`
\`${reportSh} task-done DELIVERY "PR #N ready"\`

No QA report = no PR. QA fail = no PR. NEVER skip steps.
If you receive [HIVE:HUMAN], follow that instruction immediately.
`;
}
function findTaskGroupForAgentInData(agentId, taskGroups) {
  for (const tg of taskGroups) {
    if (tg.managerId === agentId || tg.qaId === agentId || tg.criticId === agentId || tg.workerIds?.includes(agentId)) {
      return { taskGroup: tg, projectId: tg.projectId };
    }
  }
  return null;
}
function findAgentCwd(agentId, agents, projects) {
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) return null;
  if (agent.worktreePath) return agent.worktreePath;
  const project = projects.find((p) => p.id === agent.projectId);
  const zone = project?.zones?.find((z) => z.id === agent.zoneId);
  return zone?.path || null;
}
function formatHiveMessage(type, payload) {
  const msg = JSON.stringify({ type, ...payload });
  return `[HIVE:${type.toUpperCase()}] ${msg}\r`;
}
function generateReportScript(agentId, port) {
  return `#!/bin/bash
# Report task progress to Hive
# Usage:
#   .claude/hive-report.sh start "Fixing login bug"
#   .claude/hive-report.sh done "Fixed login bug, added validation"
#   .claude/hive-report.sh todo '{"items":[...]}'
#   .claude/hive-report.sh task-create '{"projectId":"...","title":"...","scope":"..."}'
#   .claude/hive-report.sh task-assign TASK_ID AGENT_ID
#   .claude/hive-report.sh task-done TASK_ID "summary"
#   .claude/hive-report.sh task-blocked TASK_ID "reason"
#   .claude/hive-report.sh task-status
#   .claude/hive-report.sh ready
#   .claude/hive-report.sh report-human "message"
#   .claude/hive-report.sh batch-propose '{"batch":1,"tasks":[...]}'

ACTION="$1"
MSG="$2"
AGENT="${agentId}"
PORT=${port}

case "$ACTION" in
  start)
    curl -s -X POST http://127.0.0.1:$PORT/report -H "Content-Type: application/json" \\
      -d "{\\"agentId\\":\\"$AGENT\\",\\"type\\":\\"task_start\\",\\"title\\":\\"$MSG\\"}" > /dev/null 2>&1
    ;;
  done)
    curl -s -X POST http://127.0.0.1:$PORT/report -H "Content-Type: application/json" \\
      -d "{\\"agentId\\":\\"$AGENT\\",\\"type\\":\\"task_done\\",\\"summary\\":\\"$MSG\\"}" > /dev/null 2>&1
    ;;
  todo)
    curl -s -X POST http://127.0.0.1:$PORT/report -H "Content-Type: application/json" \\
      -d "{\\"agentId\\":\\"$AGENT\\",\\"type\\":\\"todo\\",$(echo $MSG | sed 's/^{//')}" > /dev/null 2>&1
    ;;
  task-create)
    # Inject agentId so server can resolve projectId from task group
    PAYLOAD=$(echo "$MSG" | sed "s/^{/{\\"agentId\\":\\"$AGENT\\",/")
    curl -s -X POST http://127.0.0.1:$PORT/task-create -H "Content-Type: application/json" \\
      -d "$PAYLOAD"
    ;;
  task-assign)
    TASK_ID="$2"
    TARGET="$3"
    curl -s -X POST http://127.0.0.1:$PORT/task-assign -H "Content-Type: application/json" \\
      -d "{\\"projectId\\":\\"\\",\\"taskId\\":\\"$TASK_ID\\",\\"agentId\\":\\"$TARGET\\"}" > /dev/null 2>&1
    ;;
  task-done)
    TASK_ID="$2"
    SUMMARY="$3"
    curl -s -X POST http://127.0.0.1:$PORT/task-done -H "Content-Type: application/json" \\
      -d "{\\"agentId\\":\\"$AGENT\\",\\"taskId\\":\\"$TASK_ID\\",\\"summary\\":\\"$SUMMARY\\"}" > /dev/null 2>&1
    ;;
  task-blocked)
    TASK_ID="$2"
    REASON="$3"
    curl -s -X POST http://127.0.0.1:$PORT/task-blocked -H "Content-Type: application/json" \\
      -d "{\\"agentId\\":\\"$AGENT\\",\\"taskId\\":\\"$TASK_ID\\",\\"reason\\":\\"$REASON\\"}" > /dev/null 2>&1
    ;;
  task-status)
    curl -s -X POST http://127.0.0.1:$PORT/task-status -H "Content-Type: application/json" \\
      -d "{\\"agentId\\":\\"$AGENT\\"}"
    ;;
  ready)
    curl -s -X POST http://127.0.0.1:$PORT/ready -H "Content-Type: application/json" \\
      -d "{\\"agentId\\":\\"$AGENT\\"}" > /dev/null 2>&1
    ;;
  report-human)
    curl -s -X POST http://127.0.0.1:$PORT/report-human -H "Content-Type: application/json" \\
      -d "{\\"agentId\\":\\"$AGENT\\",\\"message\\":\\"$MSG\\"}" > /dev/null 2>&1
    ;;
  batch-propose)
    # Inject agentId into the JSON payload
    PAYLOAD=$(echo "$MSG" | sed "s/^{/{\\"agentId\\":\\"$AGENT\\",/")
    curl -s -X POST http://127.0.0.1:$PORT/batch-propose -H "Content-Type: application/json" \\
      -d "$PAYLOAD" > /dev/null 2>&1
    ;;
esac
`;
}
const DATA_DIR = process.env.HIVE_DATA_DIR || path.join(electron.app.getPath("home"), ".hive");
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
  const bakFile = DATA_FILE + ".bak";
  try {
    if (fs.existsSync(DATA_FILE)) fs.writeFileSync(bakFile, fs.readFileSync(DATA_FILE));
  } catch {
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
const terminals = /* @__PURE__ */ new Map();
const HIVE_PORT = parseInt(process.env.HIVE_PORT || "17710", 10);
const LOGS_DIR = path.join(DATA_DIR, "logs");
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
function sendToAgent(agentId, type, payload) {
  const term = terminals.get(agentId);
  if (!term) return false;
  term.write(formatHiveMessage(type, payload));
  return true;
}
function autoAssignNext(workerId, projectId) {
  const allTasks = listTasks(DATA_DIR, projectId);
  let next = allTasks.find((t) => t.owner === workerId && t.status === "pending");
  if (!next) next = allTasks.find((t) => !t.owner && t.status === "pending");
  if (next) {
    const updated = updateTask(DATA_DIR, projectId, next.id, { status: "assigned", owner: workerId, assignedAt: (/* @__PURE__ */ new Date()).toISOString() });
    if (updated) {
      const sent = sendToAgent(workerId, "TASK", updated);
      dispatchLog("auto-assign", `${updated.id} → ${workerId} (PTY: ${sent})`);
    }
  }
}
function dispatchLog(action, detail) {
  const win = electron.BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send("dispatcher:log", { time: (/* @__PURE__ */ new Date()).toISOString(), action, detail });
  }
}
function notifyHuman(title, message) {
  const win = electron.BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) win.webContents.send("manager:report", { title, message });
  try {
    const escaped = message.replace(/"/g, '\\"').replace(/'/g, "'");
    child_process.execSync(`osascript -e 'display notification "${escaped}" with title "Hive: ${title}" sound name "Glass"'`);
  } catch {
  }
  try {
    const payload = JSON.stringify({ last_assistant_message: message, cwd: process.cwd() });
    child_process.execSync(`echo '${payload.replace(/'/g, "'\\''")}' | /Users/meiyang/.claude/hooks/notify-telegram.sh`, { timeout: 5e3 });
  } catch {
  }
}
function findTaskGroupForAgent(agentId) {
  const d = loadData();
  return findTaskGroupForAgentInData(agentId, d.taskGroups || []);
}
function findAgentWorktree(agentId) {
  const d = loadData();
  return findAgentCwd(agentId, d.agents || [], d.projects || []);
}
const statusServer = http.createServer((req, res) => {
  if (req.method === "GET" && req.url?.startsWith("/task-status")) {
    const url = new URL(req.url, `http://127.0.0.1:${HIVE_PORT}`);
    const projectId = url.searchParams.get("projectId") || "";
    const homeDir = DATA_DIR;
    const tasks = listTasks(homeDir, projectId);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(tasks));
    return;
  }
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
      } else if (req.url === "/task-create") {
        const homeDir = DATA_DIR;
        const ctx = data.agentId ? findTaskGroupForAgent(data.agentId) : null;
        const projectId = ctx?.projectId || data.projectId || "";
        const task = createTask(homeDir, projectId, {
          title: data.title,
          status: "pending",
          owner: null,
          batch: data.batch || 1,
          depends: data.depends || [],
          scope: data.scope || ".",
          acceptance: data.acceptance || "",
          verify: data.verify || [],
          attempt: 0,
          blocked_reason: null,
          estimatedMinutes: data.estimatedMinutes || null,
          assignedAt: null
        });
        dispatchLog("task-create", `${task.id}: "${data.title}" in ${projectId}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: task.id }));
        return;
      } else if (req.url === "/task-assign") {
        const homeDir = DATA_DIR;
        const ctx = findTaskGroupForAgent(data.agentId);
        const projectId = data.projectId || ctx?.projectId || "";
        const allTasks = listTasks(homeDir, projectId);
        const workerBusy = allTasks.find((t) => t.owner === data.agentId && (t.status === "assigned" || t.status === "in_progress"));
        if (workerBusy) {
          dispatchLog("task-assign", `⛔ REJECTED ${data.taskId} — worker ${data.agentId} busy with ${workerBusy.id}. Will auto-assign when free.`);
        } else {
          const task = updateTask(homeDir, projectId, data.taskId, { status: "assigned", owner: data.agentId, assignedAt: (/* @__PURE__ */ new Date()).toISOString() });
          if (task) {
            const sent = sendToAgent(data.agentId, "TASK", task);
            dispatchLog("task-assign", `${task.id} → ${data.agentId} (PTY: ${sent})`);
            appendLog(data.agentId, { time: (/* @__PURE__ */ new Date()).toISOString(), type: "task_start", message: `${task.title} (PTY: ${sent})` });
          } else {
            dispatchLog("task-assign", `❌ FAILED: taskId="${data.taskId}" not found in ${projectId}`);
          }
        }
      } else if (req.url === "/task-done") {
        const homeDir = DATA_DIR;
        const ctx = findTaskGroupForAgent(data.agentId);
        const projectId = data.projectId || ctx?.projectId || "";
        const task = readTask(homeDir, projectId, data.taskId);
        dispatchLog("task-done", `${data.taskId} by ${data.agentId}: "${data.summary || ""}"`);
        const cwd = findAgentWorktree(data.agentId);
        if (task && cwd && task.verify && task.verify.length > 0) {
          dispatchLog("gate", `Running gate on ${data.taskId} (${task.verify.length} verify commands)`);
          runGate(cwd, { scope: task.scope, verify: task.verify }).then((gateResult) => {
            if (gateResult.pass) {
              updateTask(homeDir, projectId, data.taskId, { status: "done" });
              dispatchLog("gate", `✅ ${data.taskId} PASSED`);
              appendLog(data.agentId, { time: (/* @__PURE__ */ new Date()).toISOString(), type: "task_done", message: data.summary || "Task completed" });
              if (win && !win.isDestroyed()) win.webContents.send("agent:report", { ...data, type: "task_done" });
              sendToAgent(data.agentId, "MSG", { gate: "pass", task: data.taskId });
              if (ctx?.taskGroup) sendToAgent(ctx.taskGroup.managerId, "MSG", { task: data.taskId, status: "done", summary: data.summary });
              autoAssignNext(data.agentId, projectId);
            } else {
              const attempt = (task.attempt || 0) + 1;
              const maxRetries = ctx?.taskGroup?.maxGateRetries || 3;
              dispatchLog("gate", `❌ ${data.taskId} FAILED (attempt ${attempt}/${maxRetries}): ${gateResult.failures.map((f) => f.step).join(", ")}`);
              if (attempt >= maxRetries) {
                updateTask(homeDir, projectId, data.taskId, { status: "blocked", attempt, blocked_reason: gateResult.failures.map((f) => `${f.step}: ${f.detail}`).join("; ") });
                sendToAgent(data.agentId, "MSG", { gate: "blocked", task: data.taskId, failures: gateResult.failures });
                if (ctx?.taskGroup) sendToAgent(ctx.taskGroup.managerId, "MSG", { task: data.taskId, status: "blocked", reason: "gate failed after max retries" });
                notifyHuman("Gate Blocked", `${data.taskId}: ${gateResult.failures[0]?.detail || "gate failed"}`);
              } else {
                updateTask(homeDir, projectId, data.taskId, { status: "in_progress", attempt });
                sendToAgent(data.agentId, "MSG", { gate: "failed", task: data.taskId, attempt, maxRetries, failures: gateResult.failures });
              }
            }
          });
        } else {
          updateTask(homeDir, projectId, data.taskId, { status: "done" });
          dispatchLog("task-done", `${data.taskId} → done (no gate)`);
          appendLog(data.agentId, { time: (/* @__PURE__ */ new Date()).toISOString(), type: "task_done", message: data.summary || "Task completed" });
          if (win && !win.isDestroyed()) win.webContents.send("agent:report", { ...data, type: "task_done" });
          if (ctx?.taskGroup) sendToAgent(ctx.taskGroup.managerId, "MSG", { task: data.taskId, status: "done", summary: data.summary });
          autoAssignNext(data.agentId, projectId);
        }
      } else if (req.url === "/task-blocked") {
        const homeDir = DATA_DIR;
        const ctx = findTaskGroupForAgent(data.agentId);
        const projectId = data.projectId || ctx?.projectId || "";
        updateTask(homeDir, projectId, data.taskId, {
          status: "blocked",
          blocked_reason: data.reason,
          attempt: data.attempt || 0
        });
        dispatchLog("task-blocked", `❌ ${data.taskId}: ${data.reason}`);
        appendLog(data.agentId, { time: (/* @__PURE__ */ new Date()).toISOString(), type: "notification", message: `BLOCKED: ${data.reason}` });
        if (ctx?.taskGroup) sendToAgent(ctx.taskGroup.managerId, "MSG", { task: data.taskId, status: "blocked", reason: data.reason });
        notifyHuman("Task Blocked", `${data.taskId}: ${data.reason}`);
      } else if (req.url === "/task-status") {
        const homeDir = DATA_DIR;
        const ctx = findTaskGroupForAgent(data.agentId);
        const projectId = data.projectId || ctx?.projectId || "";
        const tasks = listTasks(homeDir, projectId);
        try {
          const debugLog = path.join(DATA_DIR, "task-status-debug.log");
          const line = `${(/* @__PURE__ */ new Date()).toISOString()} agentId=${data.agentId} ctx=${ctx ? ctx.projectId : "null"} projectId=${projectId} tasks=${tasks.length}
`;
          fs.writeFileSync(debugLog, (fs.existsSync(debugLog) ? fs.readFileSync(debugLog, "utf-8") : "") + line);
        } catch {
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(tasks));
        return;
      } else if (req.url === "/ready") {
        dispatchLog("ready", `${data.agentId} available for next task`);
        const ctx = findTaskGroupForAgent(data.agentId);
        if (ctx?.taskGroup) {
          setTimeout(() => {
            sendToAgent(ctx.taskGroup.managerId, "MSG", { worker: data.agentId, status: "ready" });
          }, 2e3);
        }
      } else if (req.url === "/report-human") {
        notifyHuman("Manager", data.message || "");
        appendLog(data.agentId, { time: (/* @__PURE__ */ new Date()).toISOString(), type: "report", message: data.message });
      } else if (req.url === "/batch-propose") {
        dispatchLog("batch-propose", `Batch ${data.batch || "?"}: ${(data.tasks || []).length} tasks`);
        const d = loadData();
        const tgs = d.taskGroups || [];
        const ctx = data.agentId ? findTaskGroupForAgentInData(data.agentId, tgs) : null;
        if (ctx) {
          ctx.taskGroup.status = "batch_proposed";
          saveData(d);
        }
        if (win && !win.isDestroyed()) win.webContents.send("batch:proposal", data);
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
  if (config.taskGroupRole === "manager") {
    const absReportSh = path.join(cwd, ".claude", "hive-report.sh");
    yaml += getManagerSoulAddendum({
      todoSource: config.todoSource || "docs/todo.md",
      projectId: config.taskGroupProjectId,
      workers: config.taskGroupWorkers,
      qaId: config.taskGroupQaId,
      qaName: config.taskGroupQaName,
      criticId: config.taskGroupCriticId,
      criticName: config.taskGroupCriticName,
      reportScriptPath: absReportSh
    });
  } else if (config.taskGroupRole === "worker") {
    const absReportSh = path.join(cwd, ".claude", "hive-report.sh");
    yaml += getWorkerSoulAddendum({ maxRetries: config.maxGateRetries || 3, reportScriptPath: absReportSh });
  } else if (config.taskGroupRole === "qa") {
    const absReportSh = path.join(cwd, ".claude", "hive-report.sh");
    yaml += getQaSoulAddendum({ reportScriptPath: absReportSh });
  } else if (config.taskGroupRole === "critic") {
    const absReportSh = path.join(cwd, ".claude", "hive-report.sh");
    yaml += getCriticSoulAddendum({ reportScriptPath: absReportSh });
  }
  fs.writeFileSync(path.join(agentsDir, `${agentName}.md`), yaml);
  const soulsDir = path.join(electron.app.getPath("home"), ".hive", "souls");
  if (!fs.existsSync(soulsDir)) fs.mkdirSync(soulsDir, { recursive: true });
  fs.writeFileSync(path.join(soulsDir, `${config.agentId}.md`), config.soul);
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
  fs.writeFileSync(reportScript, generateReportScript(config.agentId, HIVE_PORT), { mode: 493 });
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
electron.ipcMain.handle("agent:send", (_event, { agentId, type, payload }) => {
  return sendToAgent(agentId, type, payload);
});
let speechProcess = null;
electron.ipcMain.handle("speech:start", () => {
  if (speechProcess) return { ok: false, error: "already running" };
  const { spawn } = require("child_process");
  const devPath = path.join(__dirname, "..", "..", "scripts", "hive-speech");
  const prodPath = path.join(process.resourcesPath, "scripts", "hive-speech");
  const resolvedPath = fs.existsSync(devPath) ? devPath : prodPath;
  if (!fs.existsSync(resolvedPath)) return { ok: false, error: "hive-speech binary not found" };
  speechProcess = spawn(resolvedPath, [], { stdio: ["ignore", "pipe", "pipe"] });
  speechProcess.stdout?.on("data", (data) => {
    const lines = data.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      const win = electron.BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        win.webContents.send("speech:transcript", line);
      }
    }
  });
  speechProcess.on("exit", () => {
    speechProcess = null;
  });
  return { ok: true };
});
electron.ipcMain.handle("speech:stop", () => {
  if (speechProcess) {
    speechProcess.kill("SIGTERM");
    speechProcess = null;
  }
  return { ok: true };
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
    const { execSync: execSync2 } = require("child_process");
    const safeName = agentName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const branchName = `hive/${safeName}-${agentId.slice(-6)}`;
    const worktreePath = path.join(repoPath, "..", `${repoPath.split("/").pop()}-${safeName}`);
    try {
      execSync2(`git -C "${repoPath}" branch "${branchName}"`, { encoding: "utf-8", stdio: "pipe" });
    } catch {
    }
    execSync2(`git -C "${repoPath}" worktree add "${worktreePath}" "${branchName}"`, { encoding: "utf-8", stdio: "pipe" });
    return { ok: true, path: worktreePath, branch: branchName };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});
electron.ipcMain.handle("git:worktreeRemove", (_event, { repoPath, worktreePath }) => {
  try {
    const { execSync: execSync2 } = require("child_process");
    execSync2(`git -C "${repoPath}" worktree remove "${worktreePath}" --force`, { encoding: "utf-8", stdio: "pipe" });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});
electron.ipcMain.handle("git:worktreeList", (_event, { repoPath }) => {
  try {
    const { execSync: execSync2 } = require("child_process");
    const output = execSync2(`git -C "${repoPath}" worktree list --porcelain`, { encoding: "utf-8" });
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
electron.ipcMain.handle("git:createIntegration", (_event, { repoPath, batchNum, workerBranches }) => {
  try {
    const branchName = `integration/batch-${batchNum}`;
    child_process.execSync(`git -C "${repoPath}" checkout -b ${branchName} main`, { encoding: "utf-8" });
    const mergeResults = [];
    for (const branch of workerBranches) {
      try {
        child_process.execSync(`git -C "${repoPath}" merge --no-ff ${branch} -m "merge ${branch} into ${branchName}"`, { encoding: "utf-8" });
        mergeResults.push({ branch, ok: true });
      } catch (err) {
        mergeResults.push({ branch, ok: false, error: (err.message || "").slice(0, 200) });
        try {
          child_process.execSync(`git -C "${repoPath}" merge --abort`, { encoding: "utf-8" });
        } catch {
        }
        break;
      }
    }
    const allOk = mergeResults.every((r) => r.ok);
    if (allOk) {
      child_process.execSync(`git -C "${repoPath}" push origin ${branchName}`, { encoding: "utf-8" });
    }
    return { ok: allOk, branch: branchName, results: mergeResults };
  } catch (err) {
    return { ok: false, error: (err.message || "").slice(0, 300) };
  }
});
electron.ipcMain.handle("git:clone", async (_event, { url, destPath, token, provider }) => {
  try {
    const { execSync: execSync2 } = require("child_process");
    let cloneUrl = url;
    if (token && url.startsWith("https://")) {
      const urlObj = new URL(url);
      if (provider === "gitlab") {
        cloneUrl = `https://oauth2:${token}@${urlObj.host}${urlObj.pathname}`;
      } else {
        cloneUrl = `https://${token}@${urlObj.host}${urlObj.pathname}`;
      }
    }
    execSync2(`git clone "${cloneUrl}" "${destPath}"`, { encoding: "utf-8", stdio: "pipe", timeout: 12e4 });
    const folderName = destPath.split("/").pop() || "";
    return { ok: true, path: destPath, name: folderName };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});
electron.ipcMain.handle("project:scan", (_event, { zones }) => {
  const todos = [];
  let projectStage = "early-stage";
  for (const zone of zones) {
    if (!fs.existsSync(zone.path)) continue;
    if (zone.type === "rnd") {
      try {
        const { execSync: execSync2 } = require("child_process");
        const log = execSync2(`git -C "${zone.path}" log --oneline -20 --since="30 days ago" 2>/dev/null`, { encoding: "utf-8" });
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
  const SKIP = /* @__PURE__ */ new Set(["node_modules", ".git", ".next", ".cache", ".hive", ".claude", "__pycache__", ".DS_Store", ".Trash", ".Spotlight-V100", "dist", "build", "out"]);
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
electron.ipcMain.handle("fs:writeFile", (_event, { filePath, content }) => {
  try {
    fs.writeFileSync(filePath, content);
    return true;
  } catch {
    return false;
  }
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
  setInterval(() => {
    const d = loadData();
    const tgs = d.taskGroups || [];
    for (const tg of tgs) {
      const tasks = listTasks(DATA_DIR, tg.projectId);
      const now = Date.now();
      for (const task of tasks) {
        if (task.status !== "assigned" && task.status !== "in_progress" || !task.assignedAt) continue;
        const elapsed = (now - new Date(task.assignedAt).getTime()) / 6e4;
        const limit = task.estimatedMinutes || 10;
        if (elapsed > limit) {
          dispatchLog("stuck", `⏰ ${task.id} "${task.title}" exceeded ${limit}m (${Math.round(elapsed)}m elapsed, worker: ${task.owner})`);
          sendToAgent(task.owner, "MSG", { ping: task.id, message: `Task ${task.id} exceeded estimated time (${limit}m). Status?` });
          notifyHuman("Task Stuck", `${task.id} "${task.title}" — ${Math.round(elapsed)}m elapsed (est. ${limit}m). Worker: ${task.owner}`);
          updateTask(DATA_DIR, tg.projectId, task.id, { assignedAt: (/* @__PURE__ */ new Date()).toISOString() });
        }
      }
    }
  }, 6e4);
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
