"use strict";
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const pty = require("node-pty");
const child_process = require("child_process");
const node_fs = require("node:fs");
const node_path = require("node:path");
const node_os = require("node:os");
const node_child_process = require("node:child_process");
const headless = require("@xterm/headless");
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
function disposePty(term) {
  if (!term) return;
  const destroy = term.destroy;
  if (typeof destroy === "function") {
    try {
      destroy.call(term);
      return;
    } catch {
    }
  }
  try {
    term.kill();
  } catch {
  }
}
const live = /* @__PURE__ */ new Map();
function spawnPty(label, file, args, options, now = Date.now) {
  const term = pty__namespace.spawn(file, args, options);
  live.set(term, { term, label, spawnedAt: now() });
  try {
    term.onExit(() => {
      live.delete(term);
    });
  } catch {
  }
  return term;
}
function releasePty(term) {
  if (!term) return;
  live.delete(term);
  disposePty(term);
}
function livePtyHandles() {
  return Array.from(live.values());
}
function rdevMajor(rdev) {
  return rdev >>> 24 & 255;
}
function classifyWatermark(open, max) {
  if (max <= 0) return "ok";
  const ratio = open / max;
  if (ratio >= 0.8) return "critical";
  if (ratio >= 0.5) return "warn";
  return "ok";
}
function countOpenPtmxFds(deps) {
  let major;
  try {
    major = rdevMajor(deps.ptmxRdev());
  } catch {
    return null;
  }
  let fds;
  try {
    fds = deps.listFds();
  } catch {
    return null;
  }
  let count = 0;
  for (const entry of fds) {
    const fd = Number(entry);
    if (!Number.isInteger(fd)) continue;
    const rdev = deps.fstatRdev(fd);
    if (rdev === null) continue;
    if (rdevMajor(rdev) === major) count++;
  }
  return count;
}
function buildHealthReport(open, max, handles, now) {
  const byAge = [...handles].sort((a, b) => a.spawnedAt - b.spawnedAt);
  return {
    open,
    max,
    level: classifyWatermark(open, max),
    registered: handles.length,
    suspects: byAge.slice(0, 10).map((h) => ({ label: h.label, ageMs: now - h.spawnedAt }))
  };
}
function formatHealthReport(r) {
  const pct = r.max > 0 ? Math.round(r.open / r.max * 100) : 0;
  const head = `[pty-health] ${r.open}/${r.max} ptmx fds (${pct}%) · ${r.registered} registered`;
  if (r.level === "ok") return head;
  const leaked = r.open - r.registered;
  const top = r.suspects.map((s) => `${s.label}@${Math.round(s.ageMs / 1e3)}s`).join(", ");
  return `${head} · level=${r.level} · ~${leaked} fd(s) with no live handle · oldest: ${top || "none"}`;
}
function isHeadlessMode(env) {
  return env.HEADLESS === "1";
}
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
    } catch (e) {
      console.warn("[tasks] parse failed:", f, e?.message || e);
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
  const warnings = [];
  if (task.scope && task.scope !== ".") {
    const diff = runCmd("git diff --name-only origin/main...HEAD", cwd);
    if (diff.ok && diff.output) {
      const files = diff.output.split("\n").filter(Boolean);
      const outside = files.filter((f) => !f.startsWith(task.scope));
      if (outside.length > 0) {
        warnings.push({ step: "scope", detail: `Files outside scope "${task.scope}": ${outside.join(", ")}` });
      }
    }
  }
  return { pass: failures.length === 0, failures, warnings };
}
function getManagerSoulAddendum(config) {
  const tb = config.targetBranch || "staging";
  const r = config.reportScriptPath || ".claude/hive-report.sh";
  const workerList = config.workers?.map((w) => `- ${w.id} (${w.name})`).join("\n") || "(none)";
  return `

## Hive Orchestration — Manager

Project ID: ${config.projectId || "unknown"} (use in all task-create calls)
Target Branch: ${tb} (workers PR to this branch; sync with main before each batch)

### Team
Workers:
${workerList}
QA: ${config.qaId || "TBD"} (${config.qaName || "TBD"})
Critic: ${config.criticId || "TBD"} (${config.criticName || "TBD"})
Only assign tasks to worker IDs above.
Assign by module affinity — same worker handles same directory/component. Minimize cross-worker file overlap.

### Flow
1. Read todo file → parse depends/scope/verify/acceptance → group into batches (zero internal deps)
2. \`${r} batch-propose '{"batch":N,"tasks":[...]}'\` → wait for [HIVE:HUMAN] approval
3. \`${r} task-create '{"projectId":"...","title":"...","scope":"...","verify":[...],"depends":[],"batch":N,"estimatedMinutes":5,"note":"optional special instruction"}'\`
4. Assign 1 task per worker: \`${r} task-assign TASK_ID WORKER_ID\` (system auto-assigns next on done)
5. Monitor: \`${r} task-status\` every 30s + \`${r} check-inbox\` for messages from dispatcher/workers
6. When you receive [HIVE:MSG] {"status":"batch_complete",...}:
   - Review done/blocked/abandoned counts
   - Create QA task: \`${r} task-create '{"title":"[QA] Batch N — merge+test","scope":".","batch":N,"estimatedMinutes":20}'\`
   - Assign QA: \`${r} task-assign QA_TASK_ID QA_AGENT_ID\`
7. When QA reports done: create Critic task similarly, assign to Critic
8. Critic done → report human for PR merge

### QA Failure Loop (max 3 rounds)
QA fail → parse bug report → create fix tasks → Workers fix → re-trigger QA.
3 failures: \`${r} report-human "QA failed 3 rounds"\` and STOP.

### On Blocked
- Worker blocked → reassign or escalate
- All blocked → \`${r} report-human "all workers blocked"\`
- QA merge conflict → assign Worker to resolve
- Task no longer needed / repeatedly blocked → \`${r} task-abandon TASK_ID "reason"\` (reason required)
- [HIVE:HUMAN] = highest priority. [HIVE:MSG] = status updates.

### Daily Report (${config.dailyReportEnabled ? "ENABLED" : "DISABLED"})
On [HIVE:HUMAN] {"action":"daily-report","date":"YYYY-MM-DD"}:
1. Read all tasks via \`${r} task-status\`
2. Write \`docs/todo/YYYY-MM-DD-report.md\`:
   - Tasks completed today (title, worker, time)
   - Tasks blocked/abandoned (title, reason)
   - Tasks still in progress (title, worker, elapsed time)
   - Batch progress summary (batch N: X/Y done)
   - Blockers or issues needing human attention
3. Write \`docs/todo/YYYY-MM-DD+1-plan.md\`:
   - Remaining tasks from current batch (carry over)
   - Next batch preview (if current batch nearly done)
   - Estimated worker assignments
   - Known risks or dependencies
4. Commit both files: \`git add docs/todo/ && git commit -m "daily: YYYY-MM-DD report + plan"\`
5. \`${r} done "daily report done"\`
`;
}
function getWorkerSoulAddendum(config) {
  const r = config.reportScriptPath || ".claude/hive-report.sh";
  return `

## Hive Orchestration — Worker

1. Poll for tasks: \`${r} check-inbox\` — returns JSON with pending messages. Also triggered by [HIVE:INBOX] nudge.
2. Parse task from inbox: note the id, title, scope, verify[]
2. Execute the task
3. Run ALL verify[] commands yourself. Read the full output. If any fail, fix and re-run until they pass.
4. Self-check scope: \`git diff --name-only origin/main...HEAD\` — confirm only scope files changed before task-done.
5. Call \`${r} task-done TASK_ID "summary"\`.
   System sends scope warning if files are outside scope — informational only, NOT blocking. Task marked done regardless.
6. If stuck on task after ${config.maxRetries} attempts: \`${r} task-blocked TASK_ID "reason"\`
7. On done → \`${r} ready\` → \`/clear\` → wait for next [HIVE:TASK]

NEVER exit. NEVER work outside scope. [HIVE:HUMAN] = follow immediately.
`;
}
function getQaSoulAddendum(config) {
  const r = config?.reportScriptPath;
  return `

## Hive Orchestration — QA

### Merge
1. WAIT for [HIVE:TASK] type="qa" (payload has workerBranches + integrationBranch)
2. \`git checkout INTEGRATION_BRANCH && git pull\`
3. For each worker branch: \`git merge --no-edit WORKER_BRANCH\`
4. Conflict → \`${r} task-blocked QA_TASK "merge conflict: BRANCH"\` (do NOT resolve manually)

### Test
1. \`npm run build\` + \`npm test\` — both must exit 0
2. Run ALL verify[] commands from task list
3. Check coverage if available

### Report
Write markdown report: pass/fail, test count, coverage, verify results, merged branches.
- Pass: \`${r} task-done QA_TASK "QA pass — N tests, N% coverage"\`
- Fail: \`${r} task-blocked QA_TASK "failures: [details]"\`

NEVER fix code. [HIVE:HUMAN] = follow immediately.
`;
}
function getCriticSoulAddendum(config) {
  const r = config?.reportScriptPath;
  return `

## Hive Orchestration — Critic (Delivery)

1. WAIT for [HIVE:TASK] type="delivery" (branch, QA report path, task list)
2. Rebase: \`git checkout BRANCH && git fetch origin && git rebase origin/main\`
3. Read QA report — if missing or QA fail: REFUSE, report to manager
4. Run /review skill (security, logic, scope creep, quality)
5. \`gh pr create --base main --head BRANCH\` with task list + QA summary + review findings
6. \`git push origin BRANCH\` → \`${r} task-done DELIVERY "PR #N ready"\`

No QA report = no PR. QA fail = no PR. [HIVE:HUMAN] = follow immediately.
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
const SUBAGENT_ACTIVE_WINDOW_MS = 1e4;
const PROJECTS_DIR$1 = node_path.join(node_os.homedir(), ".claude", "projects");
function isAnyRecentlyTouched(files, nowMs, windowMs = SUBAGENT_ACTIVE_WINDOW_MS) {
  const cutoff = nowMs - windowMs;
  for (const f of files) {
    if (f.mtimeMs > cutoff) return true;
  }
  return false;
}
function cwdToSlug(cwd) {
  return cwd.replace(/\//g, "-");
}
function collectSubagentJsonlMtimes(cwd) {
  const slug = cwdToSlug(cwd);
  const projectDir = node_path.join(PROJECTS_DIR$1, slug);
  if (!node_fs.existsSync(projectDir)) return [];
  const out = [];
  let sessionDirs;
  try {
    sessionDirs = node_fs.readdirSync(projectDir);
  } catch {
    return out;
  }
  for (const session of sessionDirs) {
    const subagentsDir = node_path.join(projectDir, session, "subagents");
    if (!node_fs.existsSync(subagentsDir)) continue;
    let files;
    try {
      files = node_fs.readdirSync(subagentsDir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const p = node_path.join(subagentsDir, f);
      try {
        const st = node_fs.statSync(p);
        if (st.isFile()) out.push({ path: p, mtimeMs: st.mtimeMs });
      } catch {
      }
    }
  }
  return out;
}
function isSubagentActiveForCwd(cwd, nowMs = Date.now()) {
  if (!cwd) return false;
  return isAnyRecentlyTouched(collectSubagentJsonlMtimes(cwd), nowMs);
}
function generateReportScript(agentId, port, dataDir, targetBranch) {
  const branch = targetBranch || "staging";
  const lockPath = dataDir ? `${dataDir}/port.lock` : "$HOME/.hive/port.lock";
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
LOCK_FILE="${lockPath}"
if [ -f "$LOCK_FILE" ]; then
  PORT=$(head -1 "$LOCK_FILE")
else
  PORT=${port}
fi

CMD="curl -s -w \\"\\n%{http_code}\\" -X POST http://127.0.0.1:$PORT"
HDR="-H \\"Content-Type: application/json\\""

case "$ACTION" in
  # === Task Management ===
  task-create)
    PAYLOAD=$(echo "$MSG" | sed "s/^{/{\\"agentId\\":\\"$AGENT\\",/")
    $CMD/task-create $HDR -d "$PAYLOAD"
    ;;
  task-assign)
    TASK_ID="$2"; TARGET="$3"
    RESULT=$($CMD/task-assign $HDR -d "{\\"projectId\\":\\"\\",\\"taskId\\":\\"$TASK_ID\\",\\"agentId\\":\\"$TARGET\\"}")
    HTTP_CODE=$(echo "$RESULT" | tail -1)
    BODY=$(echo "$RESULT" | sed '$d')
    echo "$BODY"
    if [ "$HTTP_CODE" != "200" ]; then
      echo "ERROR: task-assign failed (HTTP $HTTP_CODE)" >&2
      exit 1
    fi
    ;;
  task-done)
    TASK_ID="$2"; SUMMARY="$3"
    # Git: commit + rebase + push with retry
    git add -A 2>/dev/null
    git diff --cached --quiet 2>/dev/null || git commit -m "task $TASK_ID: $SUMMARY" 2>/dev/null
    PUSH_OK=false
    for ATTEMPT in 1 2 3; do
      git fetch origin 2>/dev/null
      if git rev-parse --verify origin/${branch} >/dev/null 2>&1; then
        if ! git rebase origin/${branch} 2>/dev/null; then
          git rebase --abort 2>/dev/null
          if [ "$ATTEMPT" -lt 3 ]; then sleep 3; continue; fi
          echo "{\\"ok\\":false,\\"error\\":\\"rebase conflict on ${branch} after 3 attempts\\",\\"code\\":\\"REBASE_CONFLICT\\"}"
          exit 1
        fi
      fi
      if git push --force-with-lease 2>/dev/null; then
        PUSH_OK=true; break
      fi
      if [ "$ATTEMPT" -lt 3 ]; then sleep 3; fi
    done
    if [ "$PUSH_OK" = false ]; then
      echo "{\\"ok\\":false,\\"error\\":\\"git push failed after 3 attempts\\",\\"code\\":\\"PUSH_FAILED\\"}"
      exit 1
    fi
    # Retry curl to dispatcher
    for ATTEMPT in 1 2 3; do
      RESULT=$($CMD/task-done $HDR -d "{\\"agentId\\":\\"$AGENT\\",\\"taskId\\":\\"$TASK_ID\\",\\"summary\\":\\"$SUMMARY\\"}")
      if [ -n "$RESULT" ]; then echo "$RESULT"; break; fi
      if [ "$ATTEMPT" -lt 3 ]; then sleep 2; fi
    done
    ;;
  task-blocked)
    TASK_ID="$2"; REASON="$3"
    $CMD/task-blocked $HDR -d "{\\"agentId\\":\\"$AGENT\\",\\"taskId\\":\\"$TASK_ID\\",\\"reason\\":\\"$REASON\\"}"
    ;;
  task-abandon)
    TASK_ID="$2"; REASON="$3"
    RESULT=$($CMD/task-abandon $HDR -d "{\\"agentId\\":\\"$AGENT\\",\\"taskId\\":\\"$TASK_ID\\",\\"reason\\":\\"$REASON\\"}")
    HTTP_CODE=$(echo "$RESULT" | tail -1)
    BODY=$(echo "$RESULT" | sed '$d')
    echo "$BODY"
    if [ "$HTTP_CODE" != "200" ]; then
      echo "ERROR: task-abandon failed (HTTP $HTTP_CODE)" >&2
      exit 1
    fi
    ;;

  # === Query ===
  task-status)
    $CMD/task-status $HDR -d "{\\"agentId\\":\\"$AGENT\\"}"
    ;;

  # === Batch ===
  batch-propose)
    PAYLOAD=$(echo "$MSG" | sed "s/^{/{\\"agentId\\":\\"$AGENT\\",/")
    $CMD/batch-propose $HDR -d "$PAYLOAD"
    ;;

  # === Reporting ===
  start)
    $CMD/report $HDR -d "{\\"agentId\\":\\"$AGENT\\",\\"type\\":\\"task_start\\",\\"title\\":\\"$MSG\\"}"
    ;;
  done)
    $CMD/report $HDR -d "{\\"agentId\\":\\"$AGENT\\",\\"type\\":\\"task_done\\",\\"summary\\":\\"$MSG\\"}"
    ;;
  report-human)
    $CMD/report-human $HDR -d "{\\"agentId\\":\\"$AGENT\\",\\"message\\":\\"$MSG\\"}"
    ;;
  ready)
    $CMD/ready $HDR -d "{\\"agentId\\":\\"$AGENT\\"}"
    ;;

  # === Inbox (message queue) ===
  check-inbox)
    $CMD/check-inbox $HDR -d "{\\"agentId\\":\\"$AGENT\\"}"
    ;;

  *)
    echo "{\\"ok\\":false,\\"error\\":\\"unknown command: $ACTION\\"}"
    exit 1
    ;;
esac
`;
}
const CLAUDE_INSTALL_COMMAND = "curl -fsSL https://claude.ai/install.sh | bash";
function claudeStatus(canRun) {
  return { installed: canRun, installCommand: CLAUDE_INSTALL_COMMAND };
}
function pickPathLine(shellOutput) {
  const line = shellOutput.split("\n").map((s) => s.trim()).filter(Boolean).pop();
  if (!line) return null;
  return line.startsWith("/") && line.includes(":") ? line : null;
}
function pathHydrationStrategies(shell) {
  return [
    { file: shell, args: ["-lic", "printenv PATH"] },
    { file: shell, args: ["-lc", "printenv PATH"] },
    {
      file: shell,
      args: [
        "-c",
        "[ -f ~/.zshrc ] && . ~/.zshrc >/dev/null 2>&1; [ -f ~/.bash_profile ] && . ~/.bash_profile >/dev/null 2>&1; printenv PATH"
      ]
    }
  ];
}
function claudeProbeStrategies(shell) {
  return [
    { file: "claude", args: ["--version"] },
    { file: shell, args: ["-lic", "claude --version"] }
  ];
}
const CLAUDE_BIN_ENV = "HIVE_CLAUDE_BIN";
function claudeBin() {
  const p = process.env[CLAUDE_BIN_ENV];
  return p && p.trim() ? p : "claude";
}
function claudeBinStrategies(shell) {
  return [
    { file: shell, args: ["-lic", "command -v claude"] },
    { file: shell, args: ["-lc", "command -v claude"] }
  ];
}
function pickClaudeBinPath(shellOutput) {
  const lines = shellOutput.split("\n").map((s) => s.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.startsWith("/") && /(?:^|\/)claude(?:\.exe)?$/.test(l)) return l;
  }
  return null;
}
const CCUSAGE_TIMEOUT_MS = 6e4;
async function queryUsageViaCcusage() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    try {
      const child = node_child_process.spawn("ccusage", ["blocks", "--json"], {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true
      });
      let out = "";
      let killTimer = null;
      const cleanupTimer = () => {
        if (killTimer) {
          clearTimeout(killTimer);
          killTimer = null;
        }
      };
      child.stdout.on("data", (c) => {
        out += c.toString("utf8");
      });
      child.on("error", () => {
        cleanupTimer();
        finish(null);
      });
      child.on("exit", () => {
        cleanupTimer();
        try {
          const data = JSON.parse(out);
          const active = (data.blocks || []).find((b) => b.isActive);
          if (!active) return finish(null);
          finish({
            costUSD: active.costUSD,
            burnPerHour: active.burnRate?.costPerHour,
            projectedUSD: active.projection?.totalCost,
            remainingMinutes: active.projection?.remainingMinutes,
            totalTokens: active.totalTokens
          });
        } catch {
          finish(null);
        }
      });
      killTimer = setTimeout(() => {
        try {
          if (child.pid) {
            try {
              process.kill(-child.pid, "SIGTERM");
            } catch {
              try {
                child.kill("SIGTERM");
              } catch {
              }
            }
          }
        } catch {
        }
        finish(null);
      }, CCUSAGE_TIMEOUT_MS);
    } catch {
      finish(null);
    }
  });
}
async function queryUsagePctViaPty(cwd) {
  return new Promise((resolve) => {
    let done = false;
    let child = null;
    const finish = (v) => {
      if (done) return;
      done = true;
      releasePty(child);
      resolve(v);
    };
    try {
      const freshSessionId = require("crypto").randomUUID();
      child = spawnPty("usage-scrape", claudeBin(), ["--session-id", freshSessionId], {
        name: "xterm-256color",
        cols: 160,
        rows: 50,
        cwd: cwd || process.env.HOME || "/",
        env: process.env
      });
    } catch {
      return finish(null);
    }
    const term = new headless.Terminal({ cols: 160, rows: 50, scrollback: 1e3, allowProposedApi: true });
    let sent = false;
    let promptSeenAt = 0;
    let scrapeTimer = null;
    const dumpGrid = () => {
      const buf = term.buffer.active;
      const lines = [];
      for (let y = 0; y < buf.length; y++) {
        const line = buf.getLine(y);
        if (line) lines.push(line.translateToString(true));
      }
      return lines.join("\n");
    };
    const tryScrape = () => {
      const text = dumpGrid();
      const fiveOld = text.match(/Current session[\s\S]{0,300}?(\d+)\s*%\s*used/);
      const fiveNew = text.match(/\b5h\b\s*:\s*[░▒▓█▁▂▃▄▅▆▇#=\- ]*\s*(\d+)\s*%/);
      const sevenOld = text.match(/Current week[\s\S]{0,300}?(\d+)\s*%\s*used/);
      const sevenNew = text.match(/\b7d\b\s*:?\s*[░▒▓█▁▂▃▄▅▆▇#=\- ]*\s*(\d+)\s*%/);
      const weekly = text.match(/weekly[^%]*?(\d+(?:\.\d+)?)\s*%/i);
      const five = fiveOld || fiveNew;
      const seven = sevenOld || sevenNew || weekly;
      const sessionReset = text.match(/Current session[\s\S]{0,500}?Resets\s+(?:in|on|at)\s+([^\n]+?)\s*(?:\n|$)/i);
      const weekReset = text.match(/Current week[\s\S]{0,500}?Resets\s+(?:in|on|at)\s+([^\n]+?)\s*(?:\n|$)/i);
      if (five || seven) {
        finish({
          fiveHour: five ? parseInt(five[1], 10) : void 0,
          sevenDay: seven ? parseInt(seven[1], 10) : void 0,
          fiveHourReset: sessionReset ? sessionReset[1].trim() : void 0,
          sevenDayReset: weekReset ? weekReset[1].trim() : void 0
        });
      }
    };
    let warningHandled = false;
    child.onData((d) => {
      term.write(d, () => {
        const grid = dumpGrid();
        if (!warningHandled && /Settings\s+Warning|Exit and fix manually|Enter to confirm/i.test(grid)) {
          warningHandled = true;
          setTimeout(() => {
            try {
              child?.write("\r");
            } catch {
            }
          }, 200);
          return;
        }
        if (!sent) {
          const hasModelBanner = /(Opus|Sonnet|Haiku)\s+\d|claude-(?:opus|sonnet|haiku)/i.test(grid);
          const firstTen = grid.split("\n").slice(0, 20).join("\n");
          if (hasModelBanner && (firstTen.includes("❯") || /^\s*>\s/m.test(firstTen))) {
            sent = true;
            promptSeenAt = Date.now();
            setTimeout(() => {
              try {
                child?.write("/usage\r");
              } catch {
              }
            }, 500);
          }
          return;
        }
        if (Date.now() - promptSeenAt < 700) return;
        if (scrapeTimer) clearTimeout(scrapeTimer);
        scrapeTimer = setTimeout(tryScrape, 300);
      });
    });
    child.onExit(() => finish(null));
    setTimeout(() => finish(null), 25e3);
  });
}
class UsageCache {
  constructor(opts) {
    this.opts = opts;
    this.cache = null;
    this.inFlight = null;
    this.now = opts.now ?? (() => Date.now());
  }
  async get() {
    if (this.cache && this.now() - this.cache.ts < this.opts.ttlMs) return this.cache;
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      const [cc, pct] = await Promise.all([
        this.opts.fetchCc().catch(() => null),
        this.opts.fetchPct().catch(() => null)
      ]);
      const value = { cc, pct, ts: this.now() };
      this.cache = value;
      this.inFlight = null;
      return value;
    })();
    return this.inFlight;
  }
  /** Test seam. Drops cache + clears in-flight tracker. */
  reset() {
    this.cache = null;
    this.inFlight = null;
  }
}
function parseTokenStr(s) {
  if (!s) return 0;
  const m = s.trim().match(/^([\d.]+)\s*([kKmM]?)$/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  return Math.round(unit === "m" ? n * 1e6 : unit === "k" ? n * 1e3 : n);
}
function parsePctStr(s) {
  const m = (s || "").match(/([\d.]+)\s*%/);
  return m ? parseFloat(m[1]) : 0;
}
function parseMarkdownTable(markdown) {
  const lines = markdown.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("|"));
  if (lines.length < 3) return null;
  const splitRow = (l) => l.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const headers = splitRow(lines[0]);
  if (!/^\|?\s*-+/.test(lines[1].replace(/\|/g, "|"))) {
    return null;
  }
  const rows = [];
  for (let i = 2; i < lines.length; i++) rows.push(splitRow(lines[i]));
  return { headers, rows };
}
function sliceMarkdownSections(markdown) {
  const out = {};
  const re = /^###\s+(.+)$/gm;
  const matches = [];
  let m;
  while ((m = re.exec(markdown)) !== null) {
    matches.push({ name: m[1].trim().toLowerCase(), idx: m.index });
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].idx;
    const end = i + 1 < matches.length ? matches[i + 1].idx : markdown.length;
    out[matches[i].name] = markdown.slice(start, end);
  }
  return out;
}
function parseContextMarkdown(markdown) {
  const tokenMatch = markdown.match(/\*\*Tokens:\*\*\s*([\d.]+\s*[kKmM]?)\s*\/\s*([\d.]+\s*[kKmM]?)\s*\((\d+)%/);
  const totalTokens = tokenMatch ? parseTokenStr(tokenMatch[1]) : 0;
  const totalLimit = tokenMatch ? parseTokenStr(tokenMatch[2]) : 0;
  const totalPct = tokenMatch ? parseInt(tokenMatch[3], 10) : 0;
  const modelMatch = markdown.match(/\*\*Model:\*\*\s*(\S+)/);
  const model = modelMatch ? modelMatch[1] : "";
  const sections = sliceMarkdownSections(markdown);
  const categories = [];
  const catSec = sections["estimated usage by category"] || "";
  const catTab = parseMarkdownTable(catSec);
  if (catTab) {
    for (const r of catTab.rows) {
      if (r.length < 3) continue;
      categories.push({ name: r[0], tokens: parseTokenStr(r[1]), pct: parsePctStr(r[2]) });
    }
  }
  const mcpTools = [];
  const mcpTab = parseMarkdownTable(sections["mcp tools"] || "");
  if (mcpTab) {
    for (const r of mcpTab.rows) {
      if (r.length < 3) continue;
      mcpTools.push({ name: r[0], server: r[1], tokens: parseTokenStr(r[2]) });
    }
  }
  const customAgents = [];
  const agentTab = parseMarkdownTable(sections["custom agents"] || "");
  if (agentTab) {
    for (const r of agentTab.rows) {
      if (r.length < 2) continue;
      customAgents.push({
        name: r[0],
        tokens: parseTokenStr(r[r.length - 1])
      });
    }
  }
  const memoryFiles = [];
  const memTab = parseMarkdownTable(sections["memory files"] || "");
  if (memTab) {
    for (const r of memTab.rows) {
      if (r.length < 2) continue;
      memoryFiles.push({ name: r[0], tokens: parseTokenStr(r[r.length - 1]) });
    }
  }
  const skills = [];
  const skillTab = parseMarkdownTable(sections["skills"] || "");
  if (skillTab) {
    for (const r of skillTab.rows) {
      if (r.length < 3) continue;
      skills.push({ name: r[0], source: r[1], tokens: parseTokenStr(r[2]) });
    }
  }
  return { model, totalTokens, totalLimit, totalPct, categories, mcpTools, customAgents, memoryFiles, skills };
}
function latestSessionIdFromHiveLog(lines) {
  let sid = null;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try {
      const ev = JSON.parse(t);
      const s = ev?.session_id ?? ev?.event?.session_id;
      if (typeof s === "string" && s) sid = s;
    } catch {
    }
  }
  return sid;
}
function recordedCwdFromSession(lines) {
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try {
      const c = JSON.parse(t)?.cwd;
      if (typeof c === "string" && c.startsWith("/")) return c;
    } catch {
    }
  }
  return null;
}
function locateSessionBucket(projectsDir, sid) {
  if (!sid || !node_fs.existsSync(projectsDir)) return null;
  let buckets;
  try {
    buckets = node_fs.readdirSync(projectsDir);
  } catch {
    return null;
  }
  for (const bucket of buckets) {
    const file = node_path.join(projectsDir, bucket, `${sid}.jsonl`);
    if (!node_fs.existsSync(file)) continue;
    let cwd = null;
    try {
      cwd = recordedCwdFromSession(node_fs.readFileSync(file, "utf8").split("\n"));
    } catch {
    }
    if (cwd) return { dir: node_path.join(projectsDir, bucket), cwd, file };
  }
  return null;
}
function newestHiveLogForChat(hiveLogsDir, chatId) {
  if (!chatId || !node_fs.existsSync(hiveLogsDir)) return null;
  let files;
  try {
    files = node_fs.readdirSync(hiveLogsDir);
  } catch {
    return null;
  }
  const matches = files.filter((f) => f.startsWith(`${chatId}-`) && f.endsWith(".jsonl")).map((f) => ({ f, m: node_fs.statSync(node_path.join(hiveLogsDir, f)).mtimeMs })).sort((a, b) => b.m - a.m);
  return matches.length ? node_path.join(hiveLogsDir, matches[0].f) : null;
}
function resolveAgentSession(projectsDir, hiveLogsDir, chatId) {
  const log = newestHiveLogForChat(hiveLogsDir, chatId);
  if (!log) return null;
  let sid = null;
  try {
    sid = latestSessionIdFromHiveLog(node_fs.readFileSync(log, "utf8").split("\n"));
  } catch {
    return null;
  }
  if (!sid) return null;
  const loc = locateSessionBucket(projectsDir, sid);
  if (!loc) return null;
  return { sid, cwd: loc.cwd, file: loc.file };
}
function getRecentSessions(cwd, limit = 5) {
  if (!cwd) return [];
  try {
    const slug = cwd.replace(/\//g, "-");
    const dir = node_path.join(node_os.homedir(), ".claude", "projects", slug);
    if (!node_fs.existsSync(dir)) return [];
    const files = node_fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => ({ f, m: node_fs.statSync(node_path.join(dir, f)).mtimeMs })).sort((a, b) => b.m - a.m).slice(0, limit);
    let contextWindowTokens = 0;
    try {
      const hiveLogs = node_path.join(node_os.homedir(), ".hive", "chat-logs");
      if (node_fs.existsSync(hiveLogs)) {
        const hiveFiles = node_fs.readdirSync(hiveLogs).filter((f) => f.endsWith(".jsonl")).map((f) => ({ f, m: node_fs.statSync(node_path.join(hiveLogs, f)).mtimeMs })).sort((a, b) => b.m - a.m);
        outer: for (const hf of hiveFiles.slice(0, 50)) {
          const txt = node_fs.readFileSync(node_path.join(hiveLogs, hf.f), "utf8").split("\n").filter(Boolean);
          for (const line of txt) {
            try {
              const ev = JSON.parse(line);
              if (ev.type === "system" && ev.subtype === "init" && ev.cwd === cwd && typeof ev.model === "string") {
                const m = ev.model.match(/\[(\d+)([kKmM])\]/);
                if (m) {
                  const n = parseInt(m[1], 10);
                  contextWindowTokens = m[2].toLowerCase() === "m" ? n * 1e6 : n * 1e3;
                  break outer;
                }
              }
            } catch {
            }
          }
        }
      }
    } catch {
    }
    if (!contextWindowTokens) contextWindowTokens = 1e6;
    return files.map((file) => {
      const sid = file.f.replace(/\.jsonl$/, "");
      let title = "";
      let preview = "";
      let lastInputTokens = 0;
      try {
        const lines = node_fs.readFileSync(node_path.join(dir, file.f), "utf8").split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const ev = JSON.parse(line);
            if (!title && ev.type === "last-prompt" && typeof ev.lastPrompt === "string") {
              const t = ev.lastPrompt.trim();
              if (t) title = t.length > 120 ? t.slice(0, 120) + "…" : t;
            }
            if (ev.type === "assistant") {
              const blocks = ev.message?.content || [];
              for (const b of blocks) {
                if (b?.type === "text" && typeof b.text === "string" && b.text.trim()) {
                  const t = b.text.trim();
                  preview = t.length > 160 ? t.slice(0, 160) + "…" : t;
                }
              }
              const u = ev.message?.usage;
              if (u) {
                const its = Array.isArray(u.iterations) ? u.iterations : [];
                const last = its.length > 0 ? its[its.length - 1] : u;
                const total = (last.input_tokens || 0) + (last.cache_read_input_tokens || 0) + (last.cache_creation_input_tokens || 0);
                if (total) lastInputTokens = total;
              }
            }
          } catch {
          }
        }
      } catch {
      }
      const ctxPct = lastInputTokens > 0 ? Math.round(lastInputTokens / contextWindowTokens * 100) : 0;
      return {
        sid,
        title: title || "(no title)",
        preview: preview || "(no preview)",
        lastActiveMs: file.m,
        ctxPct,
        totalTokens: lastInputTokens
      };
    });
  } catch {
    return [];
  }
}
function getPrevSessionInfo(cwd, chatId) {
  if (!cwd) return null;
  try {
    let sessionFile = null;
    let sid = "";
    let effectiveCwd = cwd;
    let lastActiveMs = 0;
    const slug = cwd.replace(/\//g, "-");
    const dir = node_path.join(node_os.homedir(), ".claude", "projects", slug);
    if (node_fs.existsSync(dir)) {
      const files = node_fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => ({ f, m: node_fs.statSync(node_path.join(dir, f)).mtimeMs })).sort((a, b) => b.m - a.m);
      if (files.length) {
        sessionFile = node_path.join(dir, files[0].f);
        sid = files[0].f.replace(/\.jsonl$/, "");
        lastActiveMs = files[0].m;
      }
    }
    if (!sessionFile && chatId) {
      const resolved = resolveAgentSession(
        node_path.join(node_os.homedir(), ".claude", "projects"),
        node_path.join(node_os.homedir(), ".hive", "chat-logs"),
        chatId
      );
      if (resolved) {
        sessionFile = resolved.file;
        sid = resolved.sid;
        effectiveCwd = resolved.cwd;
        try {
          lastActiveMs = node_fs.statSync(resolved.file).mtimeMs;
        } catch {
        }
      }
    }
    if (!sessionFile) return null;
    let model = "";
    let peakInputTokens = 0;
    const lines = node_fs.readFileSync(sessionFile, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const ev = JSON.parse(line);
        if (ev.type === "assistant") {
          const msg = ev.message || {};
          if (msg.model) model = msg.model;
          const u = msg.usage;
          if (u) {
            const its = Array.isArray(u.iterations) ? u.iterations : [];
            const last = its.length > 0 ? its[its.length - 1] : u;
            const total = (last.input_tokens || 0) + (last.cache_read_input_tokens || 0) + (last.cache_creation_input_tokens || 0);
            peakInputTokens = total;
          }
        }
      } catch {
      }
    }
    let contextSize = "";
    try {
      const hiveLogs = node_path.join(node_os.homedir(), ".hive", "chat-logs");
      if (node_fs.existsSync(hiveLogs)) {
        const hiveFiles = node_fs.readdirSync(hiveLogs).filter((f) => f.endsWith(".jsonl")).map((f) => ({ f, m: node_fs.statSync(node_path.join(hiveLogs, f)).mtimeMs })).sort((a, b) => b.m - a.m);
        outer: for (const hf of hiveFiles.slice(0, 50)) {
          const txt = node_fs.readFileSync(node_path.join(hiveLogs, hf.f), "utf8").split("\n").filter(Boolean);
          for (const line of txt) {
            try {
              const ev = JSON.parse(line);
              if (ev.type === "system" && ev.subtype === "init" && ev.cwd === effectiveCwd && typeof ev.model === "string") {
                const m = ev.model.match(/\[(\d+[kKmM])\]/);
                if (m) {
                  contextSize = m[1].toUpperCase();
                  break outer;
                }
              }
            } catch {
            }
          }
        }
      }
    } catch {
    }
    if (!contextSize && model) {
      contextSize = /haiku/i.test(model) ? "200K" : "1M";
    }
    return { sid, model, contextSize, peakInputTokens, lastActiveMs, cwd: effectiveCwd };
  } catch {
    return null;
  }
}
function shouldAutoAllow(event, allowedTools) {
  if (!event || typeof event !== "object") return { autoAllow: false };
  const ev = event;
  if (ev.type !== "control_request") return { autoAllow: false };
  const req = ev.request;
  if (!req || typeof req !== "object") return { autoAllow: false };
  const r = req;
  if (r.subtype !== "can_use_tool") return { autoAllow: false };
  const toolName = r.tool_name;
  if (typeof toolName !== "string" || !toolName) return { autoAllow: false };
  if (!allowedTools.has(toolName)) return { autoAllow: false };
  const requestId = ev.request_id;
  if (typeof requestId !== "string" || !requestId) return { autoAllow: false };
  const rawInput = r.input;
  const input = rawInput && typeof rawInput === "object" && !Array.isArray(rawInput) ? rawInput : {};
  return { autoAllow: true, requestId, toolName, input };
}
const sessions = /* @__PURE__ */ new Map();
const sessionAllowedTools = /* @__PURE__ */ new Map();
function getAllowedTools(id) {
  let set = sessionAllowedTools.get(id);
  if (!set) {
    set = /* @__PURE__ */ new Set();
    sessionAllowedTools.set(id, set);
  }
  return set;
}
function logDir() {
  const base = process.env.HIVE_DATA_DIR || node_path.join(electron.app.getPath("home"), ".hive");
  const dir = node_path.join(base, "chat-logs");
  if (!node_fs.existsSync(dir)) node_fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const LOG_RETENTION_DAYS = 30;
function sweepOldLogs() {
  try {
    const dir = logDir();
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 3600 * 1e3;
    let removed = 0;
    for (const f of node_fs.readdirSync(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      const path2 = node_path.join(dir, f);
      try {
        const m = node_fs.statSync(path2).mtimeMs;
        if (m < cutoff) {
          node_fs.unlinkSync(path2);
          removed++;
        }
      } catch {
      }
    }
    if (removed > 0) console.log(`[chat] retention: removed ${removed} log(s) older than ${LOG_RETENTION_DAYS}d`);
  } catch (e) {
    console.warn("[chat] retention sweep failed:", e);
  }
}
sweepOldLogs();
function broadcast(event, payload) {
  for (const win of electron.BrowserWindow.getAllWindows()) {
    win.webContents.send(event, payload);
  }
}
const AUTO_CONTINUE_FILE = () => node_path.join(process.env.HIVE_DATA_DIR || node_path.join(electron.app.getPath("home"), ".hive"), "chat-auto-continue.json");
const AUTO_CONTINUE_BUFFER_MS = 6e4;
const AUTO_CONTINUE_MSG = "Limit reset — please continue.";
function loadAutoContinue() {
  try {
    if (node_fs.existsSync(AUTO_CONTINUE_FILE())) return JSON.parse(node_fs.readFileSync(AUTO_CONTINUE_FILE(), "utf-8"));
  } catch {
  }
  return {};
}
function saveAutoContinue(state) {
  try {
    node_fs.writeFileSync(AUTO_CONTINUE_FILE(), JSON.stringify(state));
  } catch {
  }
}
function persistAutoContinue(id, fireAt) {
  const s = loadAutoContinue();
  if (fireAt == null) delete s[id];
  else s[id] = { fireAt };
  saveAutoContinue(s);
}
function scheduleAutoContinue(id, fireAt) {
  const session = sessions.get(id);
  if (!session) return;
  if (session.autoContinueTimer) clearTimeout(session.autoContinueTimer);
  session.autoContinueAt = fireAt;
  persistAutoContinue(id, fireAt);
  broadcast(`chat:autoContinue:${id}`, { at: fireAt });
  const delay = Math.max(0, fireAt - Date.now());
  session.autoContinueTimer = setTimeout(() => {
    const s = sessions.get(id);
    if (!s) return;
    s.autoContinueTimer = void 0;
    s.autoContinueAt = void 0;
    persistAutoContinue(id, null);
    broadcast(`chat:autoContinue:${id}`, null);
    sendUserMessage(id, AUTO_CONTINUE_MSG);
  }, delay);
}
function cancelAutoContinue(id) {
  const session = sessions.get(id);
  if (session?.autoContinueTimer) clearTimeout(session.autoContinueTimer);
  if (session) {
    session.autoContinueTimer = void 0;
    session.autoContinueAt = void 0;
  }
  persistAutoContinue(id, null);
  broadcast(`chat:autoContinue:${id}`, null);
  return { ok: true };
}
function parseJsonLines(buf, sessionId) {
  const events = [];
  let rest = buf;
  while (true) {
    const nl = rest.indexOf("\n");
    if (nl < 0) break;
    const line = rest.slice(0, nl).trim();
    rest = rest.slice(nl + 1);
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch (e) {
      console.warn(`[chat ${sessionId}] JSON parse fail:`, line.slice(0, 200));
    }
  }
  return { events, rest };
}
const DEFAULT_REPLAY_LIMIT = 500;
const USAGE_TTL_MS = 5 * 6e4;
const usageCaches = /* @__PURE__ */ new Map();
async function getSharedUsage(scrapeCwd) {
  const key = scrapeCwd || process.env.HOME || "/";
  let cache = usageCaches.get(key);
  if (!cache) {
    cache = new UsageCache({
      ttlMs: USAGE_TTL_MS,
      fetchCc: queryUsageViaCcusage,
      fetchPct: () => queryUsagePctViaPty(key)
    });
    usageCaches.set(key, cache);
  }
  return cache.get();
}
function replaySessionHistory(sessionId, cwd, limit = DEFAULT_REPLAY_LIMIT) {
  try {
    const slug = (cwd || "").replace(/\//g, "-");
    const dir = node_path.join(node_os.homedir(), ".claude", "projects", slug);
    if (!node_fs.existsSync(dir)) return;
    const files = node_fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => ({ f, m: node_fs.statSync(node_path.join(dir, f)).mtimeMs })).sort((a, b) => b.m - a.m);
    if (!files.length) return;
    const latest = node_path.join(dir, files[0].f);
    const lines = node_fs.readFileSync(latest, "utf8").split("\n").filter(Boolean);
    const startIdx = Math.max(0, lines.length - limit);
    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i];
      try {
        const ev = JSON.parse(line);
        if (ev.type === "user" && ev.message?.content) {
          broadcast(`chat:event:${sessionId}`, {
            type: "user",
            message: ev.message,
            session_id: ev.sessionId,
            _historical: true
          });
        } else if (ev.type === "assistant" && ev.message) {
          broadcast(`chat:event:${sessionId}`, {
            type: "assistant",
            message: ev.message,
            session_id: ev.sessionId,
            _historical: true
          });
        }
      } catch {
      }
    }
    const session = sessions.get(sessionId);
    if (session) {
      session.replayFile = latest;
      session.replayedFrom = startIdx;
    }
    broadcast(`chat:event:${sessionId}`, {
      type: "system",
      subtype: "history_replayed",
      session_id: sessionId,
      file: latest,
      count: lines.length - startIdx,
      total: lines.length,
      hasOlder: startIdx > 0
    });
  } catch {
  }
}
function loadOlderHistory(sessionId, batch = DEFAULT_REPLAY_LIMIT) {
  const session = sessions.get(sessionId);
  if (!session?.replayFile || session.replayedFrom === void 0) return { loaded: 0, hasOlder: false };
  if (session.replayedFrom === 0) return { loaded: 0, hasOlder: false };
  try {
    const lines = node_fs.readFileSync(session.replayFile, "utf8").split("\n").filter(Boolean);
    const newStart = Math.max(0, session.replayedFrom - batch);
    const events = [];
    for (let i = newStart; i < session.replayedFrom; i++) {
      try {
        const ev = JSON.parse(lines[i]);
        if (ev.type === "user" && ev.message?.content) {
          events.push({ type: "user", message: ev.message, session_id: ev.sessionId, _historical: true });
        } else if (ev.type === "assistant" && ev.message) {
          events.push({ type: "assistant", message: ev.message, session_id: ev.sessionId, _historical: true });
        }
      } catch {
      }
    }
    session.replayedFrom = newStart;
    broadcast(`chat:prepend:${sessionId}`, { events, hasOlder: newStart > 0 });
    return { loaded: events.length, hasOlder: newStart > 0 };
  } catch (e) {
    return { loaded: 0, hasOlder: false, error: String(e) };
  }
}
async function smartStartChat(id, opts = {}) {
  if (sessions.has(id) && sessions.get(id)?.child !== null) return { ok: false, error: "already_started" };
  if (opts.continueSession && opts.cwd && !opts.resumeSid) {
    try {
      const slug = opts.cwd.replace(/\//g, "-");
      const dir = node_path.join(node_os.homedir(), ".claude", "projects", slug);
      if (node_fs.existsSync(dir)) {
        const files = node_fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => ({ f, m: node_fs.statSync(node_path.join(dir, f)).mtimeMs })).sort((a, b) => b.m - a.m);
        if (files.length) {
          const sid = files[0].f.replace(/\.jsonl$/, "");
          const pct = readContextPctFromJsonl(opts.cwd, sid);
          if (pct !== null && pct > 0.5) {
            broadcast(`chat:stderr:${id}`, `⏳ Smart-startup: prior session ${(pct * 100).toFixed(0)}% context — running /compact first…
`);
            const r = await runCompactViaPrint(opts.cwd, sid, opts.agent, void 0, (msg) => broadcast(`chat:stderr:${id}`, `⏳ ${msg}
`), id);
            if (r.ok) {
              broadcast(`chat:stderr:${id}`, `✅ /compact done in ${(r.durationMs / 1e3).toFixed(1)}s
`);
            } else {
              broadcast(`chat:stderr:${id}`, `❌ /compact ${r.error} (${(r.durationMs / 1e3).toFixed(1)}s) — context UNCHANGED, resuming anyway
`);
            }
            startChat(id, { ...opts, resumeSid: sid, continueSession: false, rebaseOnStart: false });
            return { ok: true, compacted: r.ok, sid, pct };
          }
        }
      }
    } catch {
    }
  }
  startChat(id, opts);
  return { ok: true, compacted: false };
}
const COMPACT_STUCK_ELAPSED_MS = 3e5;
const COMPACT_STUCK_IDLE_MS = 6e4;
function isCompactStuck(elapsedMs, lastOutputAgeMs) {
  return elapsedMs > COMPACT_STUCK_ELAPSED_MS && lastOutputAgeMs > COMPACT_STUCK_IDLE_MS;
}
async function runCompactViaPrint(cwd, sid, agent, timeoutMs = 6e5, onProgress, chatId) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    let buffer = "";
    let resultEvent = null;
    let lastByteAt = startedAt;
    let stuckBroadcast = false;
    const progressTimer = setInterval(() => {
      if (settled) return;
      const elapsed = Date.now() - startedAt;
      const sinceLastByte = Date.now() - lastByteAt;
      onProgress?.(`/compact still running · ${Math.round(elapsed / 1e3)}s elapsed${sinceLastByte > 3e4 ? ` · last claude output ${Math.round(sinceLastByte / 1e3)}s ago` : ""}`);
      if (!stuckBroadcast && chatId && isCompactStuck(elapsed, sinceLastByte)) {
        stuckBroadcast = true;
        broadcast(`chat:compactStuck:${chatId}`, {
          elapsedMs: elapsed,
          lastOutputAgeMs: sinceLastByte
        });
      }
    }, 3e4);
    const finish = (ok, error) => {
      if (settled) return;
      settled = true;
      clearInterval(progressTimer);
      try {
        child.kill();
      } catch {
      }
      const durationMs = Date.now() - startedAt;
      try {
        const logPath = node_path.join(node_os.homedir(), ".hive", "compact-log.jsonl");
        try {
          node_fs.mkdirSync(node_path.join(node_os.homedir(), ".hive"), { recursive: true });
        } catch {
        }
        node_fs.appendFileSync(logPath, JSON.stringify({
          ts: (/* @__PURE__ */ new Date()).toISOString(),
          sid,
          cwd,
          ok,
          error,
          durationMs,
          resultSubtype: resultEvent?.subtype,
          resultUsd: resultEvent?.total_cost_usd,
          resultDurationMs: resultEvent?.duration_ms
        }) + "\n");
      } catch {
      }
      resolve({ ok, error, durationMs, resultEvent });
    };
    const args = ["--print", "--resume", sid, "/compact", "--output-format", "stream-json", "--verbose"];
    if (agent) args.unshift("--agent", agent);
    const child = node_child_process.spawn(claudeBin(), args, { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    try {
      child.stdin.end();
    } catch {
    }
    child.stdout.on("data", (chunk) => {
      lastByteAt = Date.now();
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.type === "result") {
            resultEvent = ev;
            const ok = ev.subtype === "success" && !ev.is_error;
            finish(ok, ok ? void 0 : ev.subtype || "error");
            return;
          }
        } catch {
        }
      }
    });
    child.on("error", (err) => finish(false, `spawn_error: ${err.message}`));
    child.on("exit", (code) => {
      if (resultEvent) return;
      finish(false, `exit_${code}`);
    });
    setTimeout(() => finish(false, `timeout_after_${Math.round(timeoutMs / 1e3)}s`), timeoutMs);
  });
}
function buildChatArgs(opts) {
  const args = [
    "--print",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--include-hook-events",
    "--permission-prompt-tool",
    "stdio",
    // claude emits control_request on stdout; we reply with control_response on stdin
    "--verbose"
  ];
  if (opts.agent) args.push("--agent", opts.agent);
  if (opts.name) args.push("-n", opts.name);
  if (opts.resumeSid) {
    args.push("--resume", opts.resumeSid);
    if (opts.forkSession) args.push("--fork-session");
  } else if (opts.continueSession) {
    args.push("-c");
  }
  return args;
}
function startChat(id, opts = {}) {
  if (sessions.has(id) && sessions.get(id)?.child !== null) return;
  const args = buildChatArgs(opts);
  if (opts.rebaseOnStart && opts.cwd) {
    try {
      const cmd = `git fetch origin 2>&1 && BASE=$(for b in develop main master; do git rev-parse --verify origin/$b >/dev/null 2>&1 && echo $b && break; done) && [ -n "$BASE" ] && echo "⏳ Rebasing onto origin/$BASE" && git rebase origin/$BASE && echo "✅ Rebase done" || echo "⏭️ Rebase skipped"`;
      const out = node_child_process.execSync(cmd, { cwd: opts.cwd, encoding: "utf8", shell: "/bin/bash" });
      broadcast(`chat:stderr:${id}`, out);
    } catch (e) {
      broadcast(`chat:stderr:${id}`, `Rebase failed: ${e.stdout ?? ""}${e.stderr ?? ""}
`);
    }
  }
  const child = node_child_process.spawn(claudeBin(), args, {
    cwd: opts.cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  const logPath = node_path.join(logDir(), `${id}-${Date.now()}.jsonl`);
  const session = {
    id,
    child,
    buffer: "",
    startedAt: Date.now(),
    logPath,
    cwd: opts.cwd,
    mode: "print",
    startOpts: opts,
    claudeSid: opts.resumeSid
  };
  sessions.set(id, session);
  try {
    node_fs.appendFileSync(session.logPath, JSON.stringify({
      _meta: "spawn",
      t: Date.now(),
      command: "claude",
      args,
      cwd: opts.cwd ?? null
    }) + "\n");
  } catch {
  }
  try {
    const pending = loadAutoContinue()[id];
    if (pending?.fireAt) {
      if (pending.fireAt > Date.now() - 5 * 6e4) {
        scheduleAutoContinue(id, pending.fireAt);
      } else {
        persistAutoContinue(id, null);
      }
    }
  } catch {
  }
  if (opts.continueSession || opts.resumeSid) {
    setTimeout(() => replaySessionHistory(id, opts.cwd), 100);
  }
  const refresh = async () => {
    const { cc, pct } = await getSharedUsage(opts.cwd);
    if (cc || pct) broadcast(`chat:usage:${session.id}`, { ...cc || {}, ...pct || {} });
  };
  refresh();
  let lastMessageStopRefresh = 0;
  child.stdout.on("data", (chunk) => {
    session.buffer += chunk.toString("utf8");
    const { events, rest } = parseJsonLines(session.buffer, id);
    session.buffer = rest;
    let sawMessageStop = false;
    const allowedTools = getAllowedTools(id);
    for (const ev of events) {
      const decision = shouldAutoAllow(ev, allowedTools);
      if (decision.autoAllow) {
        respondPermission(id, decision.requestId, "allow", decision.input);
        try {
          node_fs.appendFileSync(session.logPath, JSON.stringify({ _meta: "auto-allow", t: Date.now(), requestId: decision.requestId, toolName: decision.toolName }) + "\n");
        } catch {
        }
        continue;
      }
      broadcast(`chat:event:${id}`, ev);
      try {
        node_fs.appendFileSync(session.logPath, JSON.stringify(ev) + "\n");
      } catch {
      }
      if (ev?.type === "stream_event" && ev.event?.type === "message_stop") sawMessageStop = true;
      if (ev?.type === "system" && ev?.subtype === "init" && ev?.session_id && !session.claudeSid) {
        session.claudeSid = ev.session_id;
      }
      if (ev?.type === "rate_limit_event" && ev.rate_limit_info?.status === "rejected") {
        const resetsAt = ev.rate_limit_info.resetsAt;
        if (typeof resetsAt === "number" && !session.autoContinueTimer) {
          scheduleAutoContinue(id, resetsAt * 1e3 + AUTO_CONTINUE_BUFFER_MS);
        }
      }
    }
    if (sawMessageStop && Date.now() - lastMessageStopRefresh > 3e4) {
      lastMessageStopRefresh = Date.now();
      setTimeout(() => refresh(), 1500);
    }
  });
  child.stderr.on("data", (chunk) => {
    const s = chunk.toString("utf8");
    broadcast(`chat:stderr:${id}`, s);
    try {
      node_fs.appendFileSync(session.logPath, JSON.stringify({ _meta: "stderr", t: Date.now(), data: s }) + "\n");
    } catch {
    }
  });
  child.on("exit", (code, signal) => {
    try {
      node_fs.appendFileSync(session.logPath, JSON.stringify({ _meta: "exit", t: Date.now(), code, signal }) + "\n");
    } catch {
    }
    const sess = sessions.get(id);
    if (sess && sess.child !== child) return;
    if (sess?.internalRecycle) {
      return;
    }
    broadcast(`chat:exit:${id}`, code ?? 0);
    if (sess) {
      sess.child = null;
    } else {
      sessions.delete(id);
    }
  });
  child.on("error", (err) => {
    try {
      node_fs.appendFileSync(session.logPath, JSON.stringify({ _meta: "spawn_error", t: Date.now(), error: String(err) }) + "\n");
    } catch {
    }
    const sess = sessions.get(id);
    if (sess && sess.child !== child) return;
    broadcast(`chat:error:${id}`, String(err));
    if (sess) {
      sess.child = null;
    } else {
      sessions.delete(id);
    }
  });
}
function respondPermission(id, requestId, decision, input, denyMessage) {
  const session = sessions.get(id);
  if (!session) return { ok: false, error: "no_session" };
  if (!session.child || session.mode !== "print") return { ok: false, error: "not_in_print_mode" };
  const inner = decision === "allow" ? { behavior: "allow", updatedInput: input || {} } : { behavior: "deny", message: denyMessage || "Denied by user" };
  const frame = {
    type: "control_response",
    response: {
      subtype: "success",
      request_id: requestId,
      response: inner
    }
  };
  try {
    session.child.stdin.write(JSON.stringify(frame) + "\n");
    try {
      node_fs.appendFileSync(session.logPath, JSON.stringify({ _direction: "stdin", ...frame }) + "\n");
    } catch {
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
function interruptSession(id) {
  const session = sessions.get(id);
  if (!session) return { ok: false, error: "no_session" };
  if (!session.child || session.mode !== "print") return { ok: false, error: "not_in_print_mode" };
  const frame = {
    type: "control_request",
    request_id: `hive-int-${Date.now()}`,
    request: { subtype: "interrupt" }
  };
  try {
    session.child.stdin.write(JSON.stringify(frame) + "\n");
    try {
      node_fs.appendFileSync(session.logPath, JSON.stringify({ _direction: "stdin", ...frame }) + "\n");
    } catch {
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
function sendUserMessage(id, text) {
  const session = sessions.get(id);
  if (!session) return { ok: false, error: "no_session" };
  if (!session.child || session.mode !== "print") return { ok: false, error: "not_in_print_mode" };
  const frame = {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text }]
    }
  };
  try {
    const line = JSON.stringify(frame) + "\n";
    session.child.stdin.write(line);
    try {
      node_fs.appendFileSync(session.logPath, JSON.stringify({ _direction: "stdin", ...frame }) + "\n");
    } catch {
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
function stopChat(id) {
  const session = sessions.get(id);
  if (!session) return;
  try {
    session.child?.kill();
  } catch {
  }
  releasePty(session.rcPty);
  if (session.usageTimer) clearInterval(session.usageTimer);
  if (session.autoContinueTimer) clearTimeout(session.autoContinueTimer);
  sessions.delete(id);
}
function startRemoteControl(id) {
  const session = sessions.get(id);
  if (!session) return { ok: false, error: "no_session" };
  if (session.mode === "rc") return { ok: false, error: "already_in_rc" };
  if (!session.claudeSid) return { ok: false, error: "no_sid_yet" };
  const sid = session.claudeSid;
  try {
    session.child?.kill();
  } catch {
  }
  session.child = null;
  session.mode = "rc";
  const rcPty = spawnPty("chat-rc", claudeBin(), ["--resume", sid], {
    name: "xterm-color",
    cols: 120,
    rows: 30,
    cwd: session.cwd || process.env.HOME || "/",
    env: { ...process.env, LC_ALL: "en_US.UTF-8", LANG: "en_US.UTF-8" }
  });
  session.rcPty = rcPty;
  rcPty.onData((data) => {
    broadcast(`chat:rc_output:${id}`, data);
    try {
      node_fs.appendFileSync(session.logPath, JSON.stringify({ _direction: "rc_stdout", data }) + "\n");
    } catch {
    }
  });
  setTimeout(() => {
    try {
      rcPty.write("/remote-control\r");
    } catch {
    }
  }, 1e3);
  rcPty.onExit((_e) => {
    broadcast(`chat:rc_exit:${id}`, {});
  });
  broadcast(`chat:event:${id}`, {
    type: "system",
    subtype: "rc_started",
    session_id: id,
    claude_sid: sid
  });
  return { ok: true, sid };
}
function readContextPctFromJsonl(cwd, sid) {
  if (!cwd || !sid) return null;
  try {
    const slug = cwd.replace(/\//g, "-");
    const file = node_path.join(node_os.homedir(), ".claude", "projects", slug, `${sid}.jsonl`);
    if (!node_fs.existsSync(file)) return null;
    const lines = node_fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const ev = JSON.parse(lines[i]);
        if (ev.type !== "result") continue;
        const inp = ev?.usage?.input_tokens;
        const cacheRead = ev?.usage?.cache_read_input_tokens || 0;
        const total = (typeof inp === "number" ? inp : 0) + cacheRead;
        const mu = ev?.modelUsage;
        if (mu && typeof mu === "object") {
          for (const k of Object.keys(mu)) {
            const cw = mu[k]?.contextWindow;
            if (typeof cw === "number" && cw > 0) {
              return total / cw;
            }
          }
        }
      } catch {
      }
    }
  } catch {
  }
  return null;
}
async function resumeSmart(id) {
  const session = sessions.get(id);
  if (!session) return { ok: false, error: "no_session" };
  if (!session.claudeSid || !session.startOpts) return { ok: false, error: "missing_state" };
  const sid = session.claudeSid;
  const opts = session.startOpts;
  const pct = readContextPctFromJsonl(session.cwd, sid);
  const needsCompact = pct !== null && pct > 0.5;
  broadcast(
    `chat:stderr:${id}`,
    pct !== null ? `Resume: prior context ${(pct * 100).toFixed(0)}% used${needsCompact ? " — running /compact first" : ""}
` : "Resume: no context data found, going direct\n"
  );
  if (needsCompact) {
    return compactSession(id);
  }
  session.internalRecycle = true;
  try {
    session.child?.kill();
  } catch {
  }
  sessions.delete(id);
  startChat(id, { ...opts, resumeSid: sid, continueSession: false, rebaseOnStart: false });
  return { ok: true, sid, compacted: false };
}
async function startWithSummary(id) {
  const session = sessions.get(id);
  if (!session) return { ok: false, error: "no_session" };
  if (!session.claudeSid || !session.startOpts) return { ok: false, error: "missing_state" };
  const sid = session.claudeSid;
  const opts = session.startOpts;
  const cwd = session.cwd || process.env.HOME || "/";
  broadcast(`chat:stderr:${id}`, "⏳ Compacting old context, then forking to new session-id…\n");
  session.internalRecycle = true;
  try {
    session.child?.kill();
  } catch {
  }
  session.child = null;
  const r = await runCompactViaPrint(cwd, sid, opts.agent, void 0, (msg) => broadcast(`chat:stderr:${id}`, `⏳ ${msg}
`), id);
  sessions.delete(id);
  startChat(id, { ...opts, resumeSid: sid, forkSession: true, continueSession: false, rebaseOnStart: false });
  if (r.ok) {
    broadcast(`chat:stderr:${id}`, `✅ Compacted + forked to new session-id (${(r.durationMs / 1e3).toFixed(1)}s)
`);
  } else {
    broadcast(`chat:stderr:${id}`, `❌ /compact ${r.error} (${(r.durationMs / 1e3).toFixed(1)}s) — forked WITHOUT summary
`);
  }
  return { ok: r.ok, error: r.error };
}
async function compactSession(id) {
  const session = sessions.get(id);
  if (!session) return { ok: false, error: "no_session" };
  if (!session.claudeSid || !session.startOpts) return { ok: false, error: "session-id not yet captured — send a message first" };
  if (session.mode !== "print") return { ok: false, error: "not_in_print_mode" };
  const sid = session.claudeSid;
  const opts = session.startOpts;
  const cwd = session.cwd || process.env.HOME || "/";
  broadcast(`chat:event:${id}`, { type: "system", subtype: "info", session_id: id });
  broadcast(`chat:stderr:${id}`, "⏳ Compacting context — pausing chat\n");
  session.internalRecycle = true;
  try {
    session.child?.kill();
  } catch {
  }
  session.child = null;
  const r = await runCompactViaPrint(cwd, sid, opts.agent, void 0, (msg) => broadcast(`chat:stderr:${id}`, `⏳ ${msg}
`), id);
  sessions.delete(id);
  startChat(id, { ...opts, resumeSid: sid, continueSession: false, rebaseOnStart: false });
  if (r.ok) {
    broadcast(`chat:stderr:${id}`, `✅ /compact done in ${(r.durationMs / 1e3).toFixed(1)}s · session resumed
`);
  } else {
    broadcast(`chat:stderr:${id}`, `❌ /compact ${r.error} (${(r.durationMs / 1e3).toFixed(1)}s) — context UNCHANGED, session resumed
`);
  }
  return { ok: r.ok, error: r.error };
}
async function resumeFromRemoteControl(id) {
  const session = sessions.get(id);
  if (!session) return { ok: false, error: "no_session" };
  if (session.mode !== "rc") return { ok: false, error: "not_in_rc" };
  if (!session.claudeSid || !session.startOpts) return { ok: false, error: "missing_state" };
  try {
    session.rcPty?.write("/desktop\r");
    await new Promise((r) => setTimeout(r, 1500));
  } catch {
  }
  releasePty(session.rcPty);
  const opts = session.startOpts;
  const sid = session.claudeSid;
  sessions.delete(id);
  startChat(id, { ...opts, resumeSid: sid, continueSession: false, rebaseOnStart: false });
  return { ok: true, sid };
}
const contextCache = /* @__PURE__ */ new Map();
const CONTEXT_TTL_MS = 5 * 60 * 1e3;
async function scrapeContextLive(id, force = false) {
  const session = sessions.get(id);
  if (!session) return { ok: false, error: "no_session" };
  if (!session.claudeSid || !session.startOpts) return { ok: false, error: "session-id not yet captured — send a message first" };
  const sid = session.claudeSid;
  if (!force) {
    const cached = contextCache.get(sid);
    if (cached && Date.now() - cached.scrapedAtMs < CONTEXT_TTL_MS) {
      return { ok: true, data: cached };
    }
  }
  const opts = session.startOpts;
  const cwd = session.cwd || process.env.HOME || "/";
  broadcast(`chat:stderr:${id}`, "⏳ Pausing chat for /context scrape (~7s)…\n");
  session.internalRecycle = true;
  try {
    session.child?.kill();
  } catch {
  }
  session.child = null;
  return new Promise((resolve) => {
    let settled = false;
    let buffer = "";
    let snapshot = null;
    const finish = (ok, error) => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
      }
      sessions.delete(id);
      startChat(id, { ...opts, resumeSid: sid, continueSession: false, rebaseOnStart: false });
      if (ok && snapshot) {
        contextCache.set(sid, snapshot);
        broadcast(`chat:stderr:${id}`, "✅ /context scraped — session resumed\n");
      } else {
        broadcast(`chat:stderr:${id}`, `⚠ /context scrape ${error || "failed"} — session resumed
`);
      }
      resolve(ok && snapshot ? { ok: true, data: snapshot } : { ok: false, error });
    };
    const args = ["--print", "--resume", sid, "/context", "--output-format", "stream-json", "--verbose"];
    if (opts.agent) args.unshift("--agent", opts.agent);
    const child = node_child_process.spawn(claudeBin(), args, { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.type === "result" && typeof ev.result === "string") {
            const parsed = parseContextMarkdown(ev.result);
            snapshot = { ...parsed, scrapedAtMs: Date.now() };
          } else if (ev.type === "assistant" && !snapshot) {
            const blocks = ev.message?.content || [];
            const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
            if (text.includes("Context Usage")) {
              const parsed = parseContextMarkdown(text);
              snapshot = { ...parsed, scrapedAtMs: Date.now() };
            }
          }
        } catch {
        }
      }
    });
    child.on("error", () => finish(false, "spawn_error"));
    child.on("exit", (code) => {
      if (snapshot) finish(true);
      else finish(false, code === 0 ? "no_result_event" : `exit_${code}`);
    });
    setTimeout(() => finish(false, "timeout"), 3e4);
  });
}
function registerChatIpc() {
  electron.ipcMain.handle("chat:start", async (_e, { id, cwd, agent, name, continueSession, rebaseOnStart, resumeSid, forkSession, forceCompact }) => {
    if (forceCompact && cwd && resumeSid) {
      if (sessions.has(id)) stopChat(id);
      broadcast(`chat:stderr:${id}`, "⏳ Compacting prior session before resume…\n");
      const r = await runCompactViaPrint(cwd, resumeSid, agent, void 0, (msg) => broadcast(`chat:stderr:${id}`, `⏳ ${msg}
`), id);
      if (r.ok) {
        broadcast(`chat:stderr:${id}`, `✅ /compact done in ${(r.durationMs / 1e3).toFixed(1)}s
`);
      } else {
        broadcast(`chat:stderr:${id}`, `❌ /compact ${r.error} (${(r.durationMs / 1e3).toFixed(1)}s) — context UNCHANGED, resuming anyway
`);
      }
      startChat(id, { cwd, agent, name, resumeSid, continueSession: false, rebaseOnStart: false });
      return { ok: true, compacted: r.ok, error: r.ok ? void 0 : r.error };
    }
    return smartStartChat(id, { cwd, agent, name, continueSession, rebaseOnStart, resumeSid, forkSession });
  });
  electron.ipcMain.handle("chat:getPrevSessionInfo", (_e, { cwd, chatId }) => getPrevSessionInfo(cwd, chatId));
  electron.ipcMain.handle("chat:getRecentSessions", (_e, { cwd, limit }) => getRecentSessions(cwd, limit ?? 5));
  electron.ipcMain.handle("chat:scrapeContext", (_e, { id, force }) => scrapeContextLive(id, !!force));
  electron.ipcMain.handle("chat:send", (_e, { id, text }) => sendUserMessage(id, text));
  electron.ipcMain.handle(
    "chat:respondPermission",
    (_e, { id, requestId, decision, input, denyMessage }) => respondPermission(id, requestId, decision, input, denyMessage)
  );
  electron.ipcMain.handle("chat:allowToolForSession", (_e, { id, toolName }) => {
    if (!id || typeof toolName !== "string" || !toolName) return { ok: false, error: "bad_input" };
    getAllowedTools(id).add(toolName);
    return { ok: true };
  });
  electron.ipcMain.handle("chat:stop", (_e, { id }) => {
    stopChat(id);
    return { ok: true };
  });
  electron.ipcMain.handle("chat:loadOlder", (_e, { id, batch }) => loadOlderHistory(id, batch));
  electron.ipcMain.handle("chat:startRemoteControl", (_e, { id }) => startRemoteControl(id));
  electron.ipcMain.handle("chat:resumeFromRemoteControl", (_e, { id }) => resumeFromRemoteControl(id));
  electron.ipcMain.handle("chat:interrupt", (_e, { id }) => interruptSession(id));
  electron.ipcMain.handle("chat:compact", (_e, { id }) => compactSession(id));
  electron.ipcMain.handle("chat:resumeSmart", (_e, { id }) => resumeSmart(id));
  electron.ipcMain.handle("chat:startWithSummary", (_e, { id }) => startWithSummary(id));
  electron.ipcMain.handle("chat:cancelAutoContinue", (_e, { id }) => cancelAutoContinue(id));
}
const PROJECTS_DIR = node_path.join(node_os.homedir(), ".claude", "projects");
function walkJsonl() {
  const out = [];
  if (!node_fs.existsSync(PROJECTS_DIR)) return out;
  const visit = (dir, isSubagent) => {
    let entries;
    try {
      entries = node_fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = node_path.join(dir, e);
      let st;
      try {
        st = node_fs.statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        visit(p, isSubagent || e === "subagents");
      } else if (st.isFile() && e.endsWith(".jsonl")) {
        out.push({ path: p, bytes: st.size, mtimeMs: st.mtimeMs, isSubagent });
      }
    }
  };
  visit(PROJECTS_DIR, false);
  return out;
}
function summarizeFiles(files, cutoffMs) {
  const stats = {
    totalFiles: 0,
    totalBytes: 0,
    mainFiles: 0,
    mainBytes: 0,
    subagentFiles: 0,
    subagentBytes: 0,
    staleFiles: 0,
    staleBytes: 0,
    staleMainFiles: 0,
    staleMainBytes: 0,
    staleSubagentFiles: 0,
    staleSubagentBytes: 0,
    topStale: []
  };
  const stale = [];
  for (const f of files) {
    stats.totalFiles++;
    stats.totalBytes += f.bytes;
    if (f.isSubagent) {
      stats.subagentFiles++;
      stats.subagentBytes += f.bytes;
    } else {
      stats.mainFiles++;
      stats.mainBytes += f.bytes;
    }
    if (f.mtimeMs < cutoffMs) {
      stats.staleFiles++;
      stats.staleBytes += f.bytes;
      if (f.isSubagent) {
        stats.staleSubagentFiles++;
        stats.staleSubagentBytes += f.bytes;
      } else {
        stats.staleMainFiles++;
        stats.staleMainBytes += f.bytes;
      }
      stale.push(f);
    }
  }
  stale.sort((a, b) => b.bytes - a.bytes);
  stats.topStale = stale.slice(0, 20).map((f) => ({ path: f.path, bytes: f.bytes, mtimeMs: f.mtimeMs }));
  return stats;
}
function getClaudeLogStats(retentionDays) {
  return summarizeFiles(walkJsonl(), Date.now() - retentionDays * 24 * 3600 * 1e3);
}
function cleanClaudeLogs(retentionDays, dryRun = false) {
  const files = walkJsonl();
  const cutoff = Date.now() - retentionDays * 24 * 3600 * 1e3;
  const result = { deletedFiles: 0, deletedBytes: 0, removedDirs: 0, errors: [] };
  const touchedDirs = /* @__PURE__ */ new Set();
  for (const f of files) {
    if (f.mtimeMs >= cutoff) continue;
    if (dryRun) {
      result.deletedFiles++;
      result.deletedBytes += f.bytes;
      continue;
    }
    try {
      node_fs.unlinkSync(f.path);
      result.deletedFiles++;
      result.deletedBytes += f.bytes;
      let d = f.path;
      for (let i = 0; i < 4; i++) {
        d = d.substring(0, d.lastIndexOf("/"));
        if (d.length <= PROJECTS_DIR.length) break;
        touchedDirs.add(d);
      }
    } catch (e) {
      result.errors.push(`${f.path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!dryRun) {
    const dirs = [...touchedDirs].sort((a, b) => b.split("/").length - a.split("/").length);
    for (const d of dirs) {
      try {
        const remaining = node_fs.readdirSync(d);
        if (remaining.length === 0) {
          node_fs.rmdirSync(d);
          result.removedDirs++;
        }
      } catch {
      }
    }
  }
  return result;
}
function registerStorageIpc() {
  electron.ipcMain.handle(
    "storage:claudeLogStats",
    (_e, { retentionDays }) => getClaudeLogStats(retentionDays)
  );
  electron.ipcMain.handle(
    "storage:cleanClaudeLogs",
    (_e, { retentionDays, dryRun }) => cleanClaudeLogs(retentionDays, !!dryRun)
  );
}
function parsePsRows(stdout) {
  const rows = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*\S)\s*$/);
    if (!m) continue;
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] });
  }
  return rows;
}
const CLAUDE_CLI_RE = /(?:^|\/)claude(?:\.exe)?(?:\s|$)/;
function commandIsClaudeCli(command) {
  return CLAUDE_CLI_RE.test(command);
}
function collectDescendantPids(rows, rootPid) {
  const childrenByPpid = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const arr = childrenByPpid.get(r.ppid);
    if (arr) arr.push(r);
    else childrenByPpid.set(r.ppid, [r]);
  }
  const queue = [...childrenByPpid.get(rootPid) || []];
  const seen = /* @__PURE__ */ new Set();
  const pids = [];
  while (queue.length) {
    const cur = queue.shift();
    if (seen.has(cur.pid)) continue;
    seen.add(cur.pid);
    pids.push(cur.pid);
    const kids = childrenByPpid.get(cur.pid);
    if (kids) queue.push(...kids);
  }
  return pids;
}
function hasClaudeDescendant(rows, rootPid) {
  const childrenByPpid = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const arr = childrenByPpid.get(r.ppid);
    if (arr) arr.push(r);
    else childrenByPpid.set(r.ppid, [r]);
  }
  const queue = [...childrenByPpid.get(rootPid) || []];
  const seen = /* @__PURE__ */ new Set();
  while (queue.length) {
    const cur = queue.shift();
    if (seen.has(cur.pid)) continue;
    seen.add(cur.pid);
    if (commandIsClaudeCli(cur.command)) return true;
    const kids = childrenByPpid.get(cur.pid);
    if (kids) queue.push(...kids);
  }
  return false;
}
function authUrlToOpen(text, alreadyOpened) {
  if (!text) return null;
  const m = text.match(/https:\/\/[^\s)>'"]+/);
  if (!m) return null;
  const url = m[0];
  return alreadyOpened.has(url) ? null : url;
}
(function hydratePathFromShell() {
  const shell2 = process.env.SHELL || "/bin/zsh";
  for (const { file, args } of pathHydrationStrategies(shell2)) {
    try {
      const out = child_process.execFileSync(file, args, { encoding: "utf-8", timeout: 7e3 });
      const path2 = pickPathLine(out);
      if (path2) {
        process.env.PATH = path2;
        return;
      }
    } catch {
    }
  }
})();
(function resolveClaudeBinPath() {
  const shell2 = process.env.SHELL || "/bin/zsh";
  let resolved = null;
  let via = "none";
  for (const { file, args } of claudeBinStrategies(shell2)) {
    try {
      const out = child_process.execFileSync(file, args, { encoding: "utf-8", timeout: 7e3 });
      const p = pickClaudeBinPath(out);
      if (p) {
        resolved = p;
        via = args.join(" ");
        process.env[CLAUDE_BIN_ENV] = p;
        break;
      }
    } catch {
    }
  }
  try {
    const dir = process.env.HIVE_DATA_DIR || path.join(electron.app.getPath("home"), ".hive");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, "claude-env-log.jsonl"),
      JSON.stringify({
        t: Date.now(),
        resolvedClaudeBin: resolved,
        via,
        pathHydrated: process.env.PATH !== "/usr/bin:/bin:/usr/sbin:/sbin"
      }) + "\n"
    );
  } catch {
  }
})();
const DATA_DIR = process.env.HIVE_DATA_DIR || path.join(electron.app.getPath("home"), ".hive");
const DATA_FILE = path.join(DATA_DIR, "data.json");
function writeCrashLog(kind, info) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(
      path.join(DATA_DIR, "crash-log.jsonl"),
      JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), kind, ...info }) + "\n"
    );
  } catch {
  }
}
process.on("uncaughtException", (err) => {
  writeCrashLog("main-uncaught-exception", {
    message: err?.message,
    stack: err?.stack,
    name: err?.name
  });
});
process.on("unhandledRejection", (reason) => {
  writeCrashLog("main-unhandled-rejection", {
    message: reason?.message || String(reason),
    stack: reason?.stack
  });
});
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
const LIMIT_STATE_FILE = path.join(DATA_DIR, "limit-state.json");
function loadLimitState() {
  try {
    if (fs.existsSync(LIMIT_STATE_FILE)) return JSON.parse(fs.readFileSync(LIMIT_STATE_FILE, "utf-8"));
  } catch {
  }
  return {};
}
function saveLimitState(state) {
  try {
    fs.writeFileSync(LIMIT_STATE_FILE, JSON.stringify(state));
  } catch {
  }
}
const limitResets = /* @__PURE__ */ new Map();
try {
  const saved = loadLimitState();
  for (const [k, v] of Object.entries(saved)) {
    limitResets.set(k, { ...v, resetTime: new Date(v.resetTime) });
  }
} catch {
}
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
function writeToInbox(agentId, type, payload) {
  try {
    const d = loadData();
    const ctx = findTaskGroupForAgentInData(agentId, d.taskGroups || []);
    const projectId = ctx?.projectId || "_global";
    const inboxDir = path.join(DATA_DIR, "comms", projectId, "inbox");
    fs.mkdirSync(inboxDir, { recursive: true });
    const inboxFile = path.join(inboxDir, `${agentId}.jsonl`);
    const entry = JSON.stringify({ time: (/* @__PURE__ */ new Date()).toISOString(), type, ...payload, _read: false }) + "\n";
    fs.appendFileSync(inboxFile, entry);
    return true;
  } catch {
    return false;
  }
}
function sendToAgent(agentId, type, payload) {
  const written = writeToInbox(agentId, type, payload);
  const term = terminals.get(agentId);
  if (term) {
    term.write("[HIVE:INBOX] Check your inbox: .claude/hive-report.sh check-inbox");
    setTimeout(() => {
      const t = terminals.get(agentId);
      if (t) t.write("\r");
    }, 150);
  }
  return written;
}
function autoAssignNext(workerId, projectId) {
  const allTasks = listTasks(DATA_DIR, projectId);
  let next = allTasks.find((t) => t.owner === workerId && t.status === "pending");
  if (!next) next = allTasks.find((t) => !t.owner && t.status === "pending");
  if (next) {
    const updated = updateTask(DATA_DIR, projectId, next.id, { status: "assigned", owner: workerId, assignedAt: (/* @__PURE__ */ new Date()).toISOString() });
    if (updated) {
      const sent = sendToAgent(workerId, "TASK", updated);
      dispatchLog("auto-assign", `${updated.id} → ${workerId} (PTY: ${sent})`, workerId);
      broadcastTasks(projectId);
    }
  }
}
const BATCH_STATE_FILE = path.join(DATA_DIR, "batch-state.json");
function loadBatchState() {
  try {
    if (fs.existsSync(BATCH_STATE_FILE)) return JSON.parse(fs.readFileSync(BATCH_STATE_FILE, "utf-8"));
  } catch {
  }
  return {};
}
function saveBatchState(state) {
  try {
    fs.writeFileSync(BATCH_STATE_FILE, JSON.stringify(state, null, 2));
  } catch {
  }
}
function checkBatchComplete(projectId) {
  const d = loadData();
  const tgs = d.taskGroups || [];
  const tg = tgs.find((t) => t.projectId === projectId);
  if (!tg) return;
  const allTasks = listTasks(DATA_DIR, projectId);
  if (allTasks.length === 0) return;
  const byBatch = /* @__PURE__ */ new Map();
  allTasks.forEach((t) => {
    const b = t.batch || 1;
    if (!byBatch.has(b)) byBatch.set(b, []);
    byBatch.get(b).push(t);
  });
  let currentBatch = 1;
  let latestTime = 0;
  for (const [bNum, bTasks] of byBatch) {
    const t = Math.max(...bTasks.map((t2) => t2.assignedAt ? new Date(t2.assignedAt).getTime() : 0));
    if (t > latestTime) {
      latestTime = t;
      currentBatch = bNum;
    }
  }
  const batchTasks = byBatch.get(currentBatch) || [];
  const pending = batchTasks.filter((t) => t.status === "pending" || t.status === "assigned" || t.status === "in_progress");
  if (pending.length > 0) return;
  const done = batchTasks.filter((t) => t.status === "done").length;
  const blocked = batchTasks.filter((t) => t.status === "blocked").length;
  const abandoned = batchTasks.filter((t) => t.status === "abandoned").length;
  if (done === 0) return;
  const workerBranches = [...new Set(batchTasks.filter((t) => t.owner).map((t) => {
    const ag = (d.agents || []).find((a) => a.id === t.owner);
    return ag?.worktreeBranch || "";
  }).filter(Boolean))];
  const stateKey = `${projectId}:batch:${currentBatch}`;
  const batchStates = loadBatchState();
  const existing = batchStates[stateKey];
  if (existing && existing.phase === "notified_manager") {
    const elapsed = (Date.now() - new Date(existing.notifiedAt).getTime()) / 6e4;
    if (elapsed > 5 && existing.retries < 3) {
      sendToAgent(tg.managerId, "MSG", {
        batch: currentBatch,
        status: "batch_complete_reminder",
        message: `Reminder: Batch ${currentBatch} complete (${done}/${batchTasks.length}). Create QA task.`
      });
      batchStates[stateKey] = { phase: "notified_manager", notifiedAt: (/* @__PURE__ */ new Date()).toISOString(), retries: existing.retries + 1 };
      saveBatchState(batchStates);
      dispatchLog("batch-complete", `📋 Batch ${currentBatch}: reminder ${existing.retries + 1}/3 → Manager`, tg.managerId);
    } else if (elapsed > 5 && existing.retries >= 3) {
      notifyHuman("Manager Unresponsive", `Batch ${currentBatch} done ${Math.round(elapsed)}m ago. Manager hasn't created QA task. Please intervene.`);
      batchStates[stateKey] = { ...existing, phase: "escalated" };
      saveBatchState(batchStates);
    }
    return;
  }
  if (existing && (existing.phase === "escalated" || existing.phase === "qa_created")) return;
  const sent = sendToAgent(tg.managerId, "MSG", {
    batch: currentBatch,
    status: "batch_complete",
    done,
    blocked,
    abandoned,
    total: batchTasks.length,
    workerBranches,
    integrationBranch: tg.targetBranch || "staging",
    message: `Batch ${currentBatch} complete: ${done} done, ${blocked} blocked, ${abandoned} abandoned. Worker branches: ${workerBranches.join(", ")}. Create QA task when ready.`
  });
  batchStates[stateKey] = { phase: "notified_manager", notifiedAt: (/* @__PURE__ */ new Date()).toISOString(), retries: 0 };
  saveBatchState(batchStates);
  dispatchLog("batch-complete", `📋 Batch ${currentBatch}: ${done}/${batchTasks.length} done → notified Manager`, tg.managerId);
  if (!sent) {
    notifyHuman("Batch Complete", `Batch ${currentBatch} done (${done}/${batchTasks.length}). Manager offline — create QA task manually.`);
  }
}
function broadcastTasks(projectId) {
  const win = electron.BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    const tasks = listTasks(DATA_DIR, projectId);
    win.webContents.send("task:update", { projectId, tasks });
  }
}
const DISPATCH_LOG_FILE = path.join(DATA_DIR, "dispatcher-log.json");
function loadDispatchLog() {
  try {
    if (fs.existsSync(DISPATCH_LOG_FILE)) return JSON.parse(fs.readFileSync(DISPATCH_LOG_FILE, "utf-8"));
  } catch {
  }
  return [];
}
function saveDispatchLog(entries) {
  try {
    fs.writeFileSync(DISPATCH_LOG_FILE, JSON.stringify(entries.slice(-500)));
  } catch {
  }
}
function dispatchLog(action, detail, agentId) {
  const entry = { time: (/* @__PURE__ */ new Date()).toISOString(), action, detail, agentId: agentId || null };
  const win = electron.BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send("dispatcher:log", entry);
  }
  const logs = loadDispatchLog();
  logs.push(entry);
  saveDispatchLog(logs);
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
        let note = data.note || null;
        if (ctx?.taskGroup) {
          const tgData = loadData();
          const tg = (tgData.taskGroups || []).find((t) => t.id === ctx.taskGroup.id);
          const targetBranch = tg?.targetBranch;
          if (targetBranch) {
            const prInstruction = `

[AUTO] 完成后: git push && gh pr create --base ${targetBranch}`;
            note = note ? note + prInstruction : prInstruction.trim();
          }
        }
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
          abandoned_reason: null,
          note,
          estimatedMinutes: data.estimatedMinutes || null,
          assignedAt: null
        });
        dispatchLog("task-create", `${task.id}: "${data.title}" in ${projectId}`, data.agentId);
        broadcastTasks(projectId);
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
          dispatchLog("task-assign", `⛔ REJECTED ${data.taskId} — busy with ${workerBusy.id}`, data.agentId);
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: `Worker busy with ${workerBusy.id}`, code: "WORKER_BUSY", busyTask: workerBusy.id }));
          return;
        } else {
          const task = updateTask(homeDir, projectId, data.taskId, { status: "assigned", owner: data.agentId, assignedAt: (/* @__PURE__ */ new Date()).toISOString() });
          if (task) {
            const sent = sendToAgent(data.agentId, "TASK", task);
            dispatchLog("task-assign", `${task.id} → ${data.agentId} (PTY: ${sent})`, data.agentId);
            appendLog(data.agentId, { time: (/* @__PURE__ */ new Date()).toISOString(), type: "task_start", message: `${task.title} (PTY: ${sent})` });
            broadcastTasks(projectId);
          } else {
            dispatchLog("task-assign", `❌ FAILED: taskId="${data.taskId}" not found in ${projectId}`);
          }
        }
      } else if (req.url === "/task-done") {
        const homeDir = DATA_DIR;
        const ctx = findTaskGroupForAgent(data.agentId);
        const projectId = data.projectId || ctx?.projectId || "";
        const task = readTask(homeDir, projectId, data.taskId);
        dispatchLog("task-done", `${data.taskId}: "${data.summary || ""}"`, data.agentId);
        const cwd = findAgentWorktree(data.agentId);
        if (task && cwd && task.scope && task.scope !== ".") {
          dispatchLog("gate", `Scope check on ${data.taskId}`, data.agentId);
          runGate(cwd, { scope: task.scope, verify: task.verify || [] }).then((gateResult) => {
            updateTask(homeDir, projectId, data.taskId, { status: "done" });
            appendLog(data.agentId, { time: (/* @__PURE__ */ new Date()).toISOString(), type: "task_done", message: data.summary || "Task completed" });
            if (win && !win.isDestroyed()) win.webContents.send("agent:report", { ...data, type: "task_done" });
            if (gateResult.warnings.length > 0) {
              const detail = gateResult.warnings.map((w) => w.detail).join("; ");
              dispatchLog("gate", `⚠️ ${data.taskId} scope warning (not blocking): ${detail.slice(0, 200)}`, data.agentId);
              sendToAgent(data.agentId, "MSG", { gate: "warning", task: data.taskId, warnings: gateResult.warnings });
            } else {
              dispatchLog("gate", `✅ ${data.taskId} scope clean`, data.agentId);
            }
            sendToAgent(data.agentId, "MSG", { gate: "pass", task: data.taskId });
            if (ctx?.taskGroup) sendToAgent(ctx.taskGroup.managerId, "MSG", { task: data.taskId, status: "done", summary: data.summary });
            broadcastTasks(projectId);
            autoAssignNext(data.agentId, projectId);
            checkBatchComplete(projectId);
          });
        } else {
          updateTask(homeDir, projectId, data.taskId, { status: "done" });
          dispatchLog("task-done", `${data.taskId} → done (no gate)`, data.agentId);
          appendLog(data.agentId, { time: (/* @__PURE__ */ new Date()).toISOString(), type: "task_done", message: data.summary || "Task completed" });
          if (win && !win.isDestroyed()) win.webContents.send("agent:report", { ...data, type: "task_done" });
          if (ctx?.taskGroup) sendToAgent(ctx.taskGroup.managerId, "MSG", { task: data.taskId, status: "done", summary: data.summary });
          broadcastTasks(projectId);
          autoAssignNext(data.agentId, projectId);
          checkBatchComplete(projectId);
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
        dispatchLog("task-blocked", `❌ ${data.taskId}: ${data.reason}`, data.agentId);
        appendLog(data.agentId, { time: (/* @__PURE__ */ new Date()).toISOString(), type: "notification", message: `BLOCKED: ${data.reason}` });
        if (ctx?.taskGroup) sendToAgent(ctx.taskGroup.managerId, "MSG", { task: data.taskId, status: "blocked", reason: data.reason });
        notifyHuman("Task Blocked", `${data.taskId}: ${data.reason}`);
        broadcastTasks(projectId);
      } else if (req.url === "/task-abandon") {
        const homeDir = DATA_DIR;
        const ctx = findTaskGroupForAgent(data.agentId);
        const projectId = data.projectId || ctx?.projectId || "";
        if (!ctx || ctx.taskGroup.managerId !== data.agentId) {
          dispatchLog("task-abandon", `⛔ REJECTED ${data.taskId} — only manager can abandon`, data.agentId);
          res.writeHead(403);
          res.end("forbidden: only manager can abandon");
          return;
        }
        if (!data.reason || !String(data.reason).trim()) {
          dispatchLog("task-abandon", `⛔ REJECTED ${data.taskId} — reason required`, data.agentId);
          res.writeHead(400);
          res.end("reason required");
          return;
        }
        const existing = readTask(homeDir, projectId, data.taskId);
        if (!existing) {
          res.writeHead(404);
          res.end("task not found");
          return;
        }
        if (existing.status === "done") {
          dispatchLog("task-abandon", `⛔ REJECTED ${data.taskId} — already done`, data.agentId);
          res.writeHead(409);
          res.end("cannot abandon completed task");
          return;
        }
        updateTask(homeDir, projectId, data.taskId, { status: "abandoned", abandoned_reason: data.reason });
        dispatchLog("task-abandon", `🚫 ${data.taskId}: ${data.reason}`, data.agentId);
        appendLog(data.agentId, { time: (/* @__PURE__ */ new Date()).toISOString(), type: "notification", message: `ABANDONED: ${data.taskId} — ${data.reason}` });
        if (existing.owner) {
          sendToAgent(existing.owner, "MSG", { task: data.taskId, status: "abandoned", reason: data.reason });
        }
        notifyHuman("Task Abandoned", `${data.taskId}: ${data.reason}`);
        broadcastTasks(projectId);
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
        dispatchLog("ready", `available for next task`, data.agentId);
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
        dispatchLog("batch-propose", `Batch ${data.batch || "?"}: ${(data.tasks || []).length} tasks`, data.agentId);
        const d = loadData();
        const tgs = d.taskGroups || [];
        const ctx = data.agentId ? findTaskGroupForAgentInData(data.agentId, tgs) : null;
        if (ctx) {
          ctx.taskGroup.status = "batch_proposed";
          saveData(d);
        }
        if (win && !win.isDestroyed()) win.webContents.send("batch:proposal", data);
      } else if (req.url === "/check-inbox") {
        const ctx = findTaskGroupForAgent(data.agentId);
        const projectId = ctx?.projectId || "_global";
        const inboxFile = path.join(DATA_DIR, "comms", projectId, "inbox", `${data.agentId}.jsonl`);
        if (!fs.existsSync(inboxFile)) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, messages: [] }));
          return;
        }
        const lines = fs.readFileSync(inboxFile, "utf-8").split("\n").filter(Boolean);
        const messages = [];
        const updated = [];
        for (const line of lines) {
          try {
            const msg = JSON.parse(line);
            if (!msg._read) {
              messages.push(msg);
              msg._read = true;
            }
            updated.push(JSON.stringify(msg));
          } catch {
            updated.push(line);
          }
        }
        fs.writeFileSync(inboxFile, updated.join("\n") + "\n");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, messages }));
        return;
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
  if (!config.soul.includes("Task Reporting")) {
    yaml += `

## Task Reporting
When you start a new task, run: \`.claude/hive-report.sh start "task title"\`
When you finish a task, run: \`.claude/hive-report.sh done "summary"\`
`;
  }
  const rsh = ".claude/hive-report.sh";
  let addendum = "";
  if (config.taskGroupRole === "manager") {
    addendum = getManagerSoulAddendum({
      todoSource: config.todoSource || "docs/todo.md",
      projectId: config.taskGroupProjectId,
      workers: config.taskGroupWorkers,
      qaId: config.taskGroupQaId,
      qaName: config.taskGroupQaName,
      criticId: config.taskGroupCriticId,
      criticName: config.taskGroupCriticName,
      reportScriptPath: rsh,
      dailyReportEnabled: config.dailyReportEnabled,
      targetBranch: config.targetBranch
    });
  } else if (config.taskGroupRole === "worker") {
    addendum = getWorkerSoulAddendum({ maxRetries: config.maxGateRetries || 3, reportScriptPath: rsh });
  } else if (config.taskGroupRole === "qa") {
    addendum = getQaSoulAddendum({ reportScriptPath: rsh });
  } else if (config.taskGroupRole === "critic") {
    addendum = getCriticSoulAddendum({ reportScriptPath: rsh });
  }
  if (addendum) {
    yaml += "\n\n<!-- hive:taskgroup:begin v=1 -->\n";
    yaml += addendum.replace(/^\n+|\n+$/g, "") + "\n";
    yaml += "<!-- hive:taskgroup:end -->\n";
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
  fs.writeFileSync(reportScript, generateReportScript(config.agentId, HIVE_PORT, DATA_DIR, config.targetBranch), { mode: 493 });
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
    if (!isHeadlessMode(process.env)) mainWindow.show();
    if (is.dev) mainWindow.webContents.openDevTools({ mode: "bottom" });
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      electron.shell.openExternal(url);
    }
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
    const term = spawnPty("terminal", userShell, ["-l"], {
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
      if (data.includes("You've hit your limit")) {
        const resetMatch = data.match(/resets\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
        if (resetMatch) {
          const now = /* @__PURE__ */ new Date();
          const timeStr = resetMatch[1];
          const match12 = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
          if (match12) {
            let hours = parseInt(match12[1]);
            const mins = match12[2] ? parseInt(match12[2]) : 0;
            const ampm = match12[3].toLowerCase();
            if (ampm === "pm" && hours !== 12) hours += 12;
            if (ampm === "am" && hours === 12) hours = 0;
            const resetTime = new Date(now);
            resetTime.setHours(hours, mins, 0, 0);
            if (resetTime.getTime() <= now.getTime()) resetTime.setDate(resetTime.getDate() + 1);
            const d = loadData();
            const ctx = findTaskGroupForAgentInData(id, d.taskGroups || []);
            let currentTaskId;
            if (ctx) {
              const tasks = listTasks(DATA_DIR, ctx.projectId);
              const activeTask = tasks.find((t) => t.owner === id && (t.status === "assigned" || t.status === "in_progress"));
              currentTaskId = activeTask?.id;
            }
            limitResets.set(id, { resetTime, taskId: currentTaskId, whipScheduled: false });
            saveLimitState(Object.fromEntries([...limitResets].map(([k, v]) => [k, { ...v, resetTime: v.resetTime.toISOString() }])));
            const resetStr = resetTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            dispatchLog("limit", `🔴 ${id} hit 5h limit — resets at ${resetStr}`, id);
            notifyHuman("Agent Limit", `Agent hit 5h limit. Resets at ${resetStr}. Will auto-whip.`);
          }
        }
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
function readPtmxMax() {
  try {
    return parseInt(child_process.execFileSync("sysctl", ["-n", "kern.tty.ptmx_max"], { encoding: "utf-8", timeout: 2e3 }).trim(), 10) || 511;
  } catch {
    return 511;
  }
}
function startPtyHealthMonitor() {
  if (process.platform !== "darwin") return;
  const max = readPtmxMax();
  const deps = {
    ptmxRdev: () => fs.statSync("/dev/ptmx").rdev,
    listFds: () => fs.readdirSync("/dev/fd"),
    fstatRdev: (fd) => {
      try {
        return fs.fstatSync(fd).rdev;
      } catch {
        return null;
      }
    }
  };
  const check = () => {
    const open = countOpenPtmxFds(deps);
    if (open === null) return;
    const report = buildHealthReport(open, max, livePtyHandles(), Date.now());
    if (report.level === "ok") return;
    console.warn(formatHealthReport(report));
  };
  const timer = setInterval(check, 10 * 6e4);
  timer.unref();
  check();
}
function killProcessTree(term) {
  let descendants = [];
  try {
    const stdout = child_process.execFileSync("ps", ["-Ao", "pid=,ppid=,command="], {
      encoding: "utf-8",
      timeout: 5e3,
      maxBuffer: 8 * 1024 * 1024
    });
    descendants = collectDescendantPids(parsePsRows(stdout), term.pid);
  } catch {
  }
  releasePty(term);
  for (const pid of descendants) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
    }
  }
  if (descendants.length) {
    const timer = setTimeout(() => {
      for (const pid of descendants) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
        }
      }
    }, 2e3);
    timer.unref();
  }
}
electron.ipcMain.handle("pty:kill", (_event, { id }) => {
  const term = terminals.get(id);
  if (term) {
    killProcessTree(term);
    terminals.delete(id);
  }
});
electron.ipcMain.handle("pty:hasAgentSession", (_event, { id }) => {
  const term = terminals.get(id);
  if (!term) return { alive: false };
  try {
    const stdout = child_process.execFileSync("ps", ["-Ao", "pid=,ppid=,command="], {
      encoding: "utf-8",
      timeout: 5e3,
      maxBuffer: 8 * 1024 * 1024
    });
    return { alive: hasClaudeDescendant(parsePsRows(stdout), term.pid) };
  } catch (err) {
    return { alive: false, error: String(err) };
  }
});
electron.ipcMain.handle("agent:send", (_event, { agentId, type, payload }) => {
  return sendToAgent(agentId, type, payload);
});
let speechProcess = null;
electron.ipcMain.handle("speech:start", () => {
  if (speechProcess) return { ok: false, error: "already running" };
  const { spawn: spawn2 } = require("child_process");
  const devPath = path.join(__dirname, "..", "..", "scripts", "hive-speech");
  const prodPath = path.join(process.resourcesPath, "scripts", "hive-speech");
  const resolvedPath = fs.existsSync(devPath) ? devPath : prodPath;
  if (!fs.existsSync(resolvedPath)) return { ok: false, error: "hive-speech binary not found" };
  speechProcess = spawn2(resolvedPath, [], { stdio: ["ignore", "pipe", "pipe"] });
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
electron.ipcMain.handle("inbox:list", (_event, { projectId }) => {
  const inboxDir = path.join(DATA_DIR, "comms", projectId, "inbox");
  if (!fs.existsSync(inboxDir)) return [];
  const result = [];
  for (const f of fs.readdirSync(inboxDir).filter((f2) => f2.endsWith(".jsonl"))) {
    const agentId = f.replace(".jsonl", "");
    const lines = fs.readFileSync(path.join(inboxDir, f), "utf-8").split("\n").filter(Boolean);
    const messages = lines.map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    }).filter(Boolean);
    result.push({ agentId, messages });
  }
  return result;
});
electron.ipcMain.handle("data:load", () => loadData());
electron.ipcMain.handle("system:username", () => {
  try {
    return require("os").userInfo().username;
  } catch {
    return "";
  }
});
electron.ipcMain.handle("settings:get", (_event, { key }) => {
  const data = loadData();
  return data.settings?.[key];
});
electron.ipcMain.handle("settings:set", (_event, { key, value }) => {
  const data = loadData();
  data.settings = { ...data.settings || {}, [key]: value };
  saveData(data);
  return true;
});
electron.ipcMain.handle("settings:addClaudeAllowRule", (_event, payload) => {
  try {
    const home = require("os").userInfo().homedir || process.env.HOME || "";
    const path2 = require("path").join(home, ".claude", "settings.json");
    const fs2 = require("fs");
    let settings = {};
    if (fs2.existsSync(path2)) {
      settings = JSON.parse(fs2.readFileSync(path2, "utf8"));
    }
    if (!settings.permissions) settings.permissions = {};
    let added = 0;
    const s = payload.suggestion || (payload.rules ? { rules: payload.rules } : null);
    if (!s) return { ok: false, error: "no suggestion" };
    if (Array.isArray(s.rules) && s.rules.length > 0) {
      if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];
      for (const r of s.rules) {
        const pattern = `${r.toolName}(${r.ruleContent})`;
        if (!settings.permissions.allow.includes(pattern)) {
          settings.permissions.allow.push(pattern);
          added++;
        }
      }
    }
    if (s.type === "addDirectories" && Array.isArray(s.directories)) {
      if (!Array.isArray(settings.permissions.additionalDirectories)) settings.permissions.additionalDirectories = [];
      for (const d of s.directories) {
        if (typeof d === "string" && !settings.permissions.additionalDirectories.includes(d)) {
          settings.permissions.additionalDirectories.push(d);
          added++;
        }
      }
    }
    if (s.type === "setMode" && typeof s.mode === "string") {
      if (settings.permissions.defaultMode !== s.mode) {
        settings.permissions.defaultMode = s.mode;
        added++;
      }
    }
    fs2.writeFileSync(path2, JSON.stringify(settings, null, 2));
    return { ok: true, added };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});
electron.ipcMain.handle("dispatcher:loadLog", () => loadDispatchLog());
electron.ipcMain.handle("dispatcher:clearLog", (_event, { keepAfter }) => {
  if (keepAfter) {
    const cutoff = new Date(keepAfter).getTime();
    const logs = loadDispatchLog().filter((e) => new Date(e.time).getTime() > cutoff);
    saveDispatchLog(logs);
    return logs;
  }
  saveDispatchLog([]);
  return [];
});
electron.ipcMain.handle("tasks:list", (_event, { projectId }) => listTasks(DATA_DIR, projectId));
electron.ipcMain.handle("data:save", (_event, data) => {
  saveData(data);
  return true;
});
electron.ipcMain.handle("fs:hasGit", (_event, { path: path$1 }) => {
  return fs.existsSync(path.join(path$1, ".git"));
});
electron.ipcMain.handle("git:commitHistory", (_event, { cwd, days }) => {
  try {
    const safeDays = Math.max(1, Math.min(3650, Math.floor(Number(days) || 1)));
    const output = child_process.execFileSync("git", ["log", `--since=${safeDays} days ago`, "--format=%ai", "--all"], { cwd, encoding: "utf-8", timeout: 1e4 });
    const byDay = {};
    for (const line of output.trim().split("\n").filter(Boolean)) {
      const date = line.slice(0, 10);
      byDay[date] = (byDay[date] || 0) + 1;
    }
    return byDay;
  } catch {
    return {};
  }
});
electron.ipcMain.handle("git:createTargetBranch", (_event, { repoPath, branch }) => {
  try {
    child_process.execFileSync("git", ["rev-parse", "--verify", branch], { cwd: repoPath, encoding: "utf-8", stdio: "pipe" });
    return { ok: true, existed: true };
  } catch {
  }
  try {
    child_process.execFileSync("git", ["rev-parse", "--verify", `origin/${branch}`], { cwd: repoPath, encoding: "utf-8", stdio: "pipe" });
    return { ok: true, existed: true };
  } catch {
  }
  try {
    child_process.execFileSync("git", ["branch", branch, "main"], { cwd: repoPath, encoding: "utf-8" });
    child_process.execFileSync("git", ["push", "origin", branch], { cwd: repoPath, encoding: "utf-8" });
    return { ok: true, existed: false };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
electron.ipcMain.handle("git:currentBranch", (_event, { cwd }) => {
  try {
    return child_process.execFileSync("git", ["branch", "--show-current"], { cwd, encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
});
electron.ipcMain.handle("git:worktreeAdd", (_event, { repoPath, agentId, agentName }) => {
  try {
    const safeName = agentName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const branchName = `hive/${safeName}-${agentId.slice(-6)}`;
    const worktreePath = path.join(repoPath, "..", `${repoPath.split("/").pop()}-${safeName}`);
    try {
      child_process.execFileSync("git", ["-C", repoPath, "branch", branchName], { encoding: "utf-8", stdio: "pipe" });
    } catch {
    }
    child_process.execFileSync("git", ["-C", repoPath, "worktree", "add", worktreePath, branchName], { encoding: "utf-8", stdio: "pipe" });
    return { ok: true, path: worktreePath, branch: branchName };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});
electron.ipcMain.handle("git:worktreeRemove", (_event, { repoPath, worktreePath }) => {
  try {
    child_process.execFileSync("git", ["-C", repoPath, "worktree", "remove", worktreePath, "--force"], { encoding: "utf-8", stdio: "pipe" });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});
electron.ipcMain.handle("git:worktreeList", (_event, { repoPath }) => {
  try {
    const output = child_process.execFileSync("git", ["-C", repoPath, "worktree", "list", "--porcelain"], { encoding: "utf-8" });
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
    const safeBatchNum = Math.max(0, Math.floor(Number(batchNum) || 0));
    const branchName = `integration/batch-${safeBatchNum}`;
    child_process.execFileSync("git", ["-C", repoPath, "checkout", "-b", branchName, "main"], { encoding: "utf-8" });
    const mergeResults = [];
    for (const branch of workerBranches) {
      try {
        child_process.execFileSync("git", ["-C", repoPath, "merge", "--no-ff", branch, "-m", `merge ${branch} into ${branchName}`], { encoding: "utf-8" });
        mergeResults.push({ branch, ok: true });
      } catch (err) {
        mergeResults.push({ branch, ok: false, error: (err.message || "").slice(0, 200) });
        try {
          child_process.execFileSync("git", ["-C", repoPath, "merge", "--abort"], { encoding: "utf-8" });
        } catch {
        }
        break;
      }
    }
    const allOk = mergeResults.every((r) => r.ok);
    if (allOk) {
      child_process.execFileSync("git", ["-C", repoPath, "push", "origin", branchName], { encoding: "utf-8" });
    }
    return { ok: allOk, branch: branchName, results: mergeResults };
  } catch (err) {
    return { ok: false, error: (err.message || "").slice(0, 300) };
  }
});
electron.ipcMain.handle("git:clone", async (_event, { url, destPath, token, provider }) => {
  try {
    let cloneUrl = url;
    if (token && url.startsWith("https://")) {
      const urlObj = new URL(url);
      if (provider === "gitlab") {
        cloneUrl = `https://oauth2:${token}@${urlObj.host}${urlObj.pathname}`;
      } else {
        cloneUrl = `https://${token}@${urlObj.host}${urlObj.pathname}`;
      }
    }
    child_process.execFileSync("git", ["clone", cloneUrl, destPath], { encoding: "utf-8", stdio: "pipe", timeout: 12e4 });
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
  const SKIP = /* @__PURE__ */ new Set(["node_modules", ".next", ".cache", ".hive", "__pycache__", ".DS_Store", ".Trash", ".Spotlight-V100"]);
  const files = [];
  const MAX_DEPTH = 10;
  const MAX_VISIT = 5e4;
  const MAX_TIME_MS = 3e3;
  const startMs = Date.now();
  function walk(dir, depth) {
    if (depth > MAX_DEPTH) return;
    if (files.length > MAX_VISIT) return;
    if (Date.now() - startMs > MAX_TIME_MS) return;
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
electron.ipcMain.handle("agent:checkSubagentActivity", (_event, { agentId }) => {
  const cwd = findAgentWorktree(agentId);
  return { active: isSubagentActiveForCwd(cwd) };
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
  const seen = /* @__PURE__ */ new Set();
  const unique = skills.filter((s) => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });
  return unique;
});
electron.app.whenReady().then(() => {
  electron.app.setName("Hive");
  electronApp.setAppUserModelId("com.hive.app");
  electron.app.on("render-process-gone", (_event, webContents, details) => {
    writeCrashLog("renderer-gone", {
      reason: details.reason,
      exitCode: details.exitCode,
      url: webContents.getURL?.()
    });
  });
  electron.app.on("child-process-gone", (_event, details) => {
    writeCrashLog("child-process-gone", {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      name: details.name,
      serviceName: details.serviceName
    });
  });
  electron.ipcMain.handle("crash:report", (_e, payload) => {
    writeCrashLog(payload?.kind || "renderer-reported", payload?.info || {});
    return { ok: true };
  });
  let authChild = null;
  electron.ipcMain.handle("auth:login", () => {
    return new Promise((resolve) => {
      const child = child_process.spawn(claudeBin(), ["auth", "login"], {
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"]
      });
      authChild = child;
      const openedUrls = /* @__PURE__ */ new Set();
      const broadcastAuth = (kind, s) => {
        for (const win of electron.BrowserWindow.getAllWindows()) {
          win.webContents.send("auth:output", { kind, text: s });
        }
        const url = authUrlToOpen(s, openedUrls);
        if (url) {
          openedUrls.add(url);
          electron.shell.openExternal(url).catch(() => {
          });
        }
      };
      child.stdout.on("data", (c) => broadcastAuth("stdout", c.toString("utf-8")));
      child.stderr.on("data", (c) => broadcastAuth("stderr", c.toString("utf-8")));
      child.on("error", (err) => {
        authChild = null;
        resolve({ ok: false, code: -1, error: err.message });
      });
      child.on("exit", (code) => {
        authChild = null;
        resolve({ ok: code === 0, code: code ?? -1 });
      });
    });
  });
  electron.ipcMain.handle("auth:cancel", () => {
    if (authChild) {
      try {
        authChild.kill("SIGTERM");
      } catch {
      }
      authChild = null;
      return { ok: true };
    }
    return { ok: false };
  });
  function claudeCanRun() {
    const shell2 = process.env.SHELL || "/bin/zsh";
    const strategies = [
      { file: claudeBin(), args: ["--version"] },
      ...claudeProbeStrategies(shell2)
    ];
    for (const { file, args } of strategies) {
      try {
        child_process.execFileSync(file, args, { timeout: 7e3, stdio: "ignore" });
        return true;
      } catch {
      }
    }
    return false;
  }
  electron.ipcMain.handle("claude:status", () => {
    if (isHeadlessMode(process.env)) return claudeStatus(true);
    return claudeStatus(claudeCanRun());
  });
  electron.ipcMain.handle("claude:install", () => {
    return new Promise((resolve) => {
      const child = child_process.spawn("bash", ["-lc", CLAUDE_INSTALL_COMMAND], {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      });
      const broadcast2 = (kind, text) => {
        for (const w of electron.BrowserWindow.getAllWindows()) {
          w.webContents.send("claude:install:output", { kind, text });
        }
      };
      child.stdout.on("data", (c) => broadcast2("stdout", c.toString("utf-8")));
      child.stderr.on("data", (c) => broadcast2("stderr", c.toString("utf-8")));
      child.on("error", (err) => {
        broadcast2("stderr", err.message);
        resolve({ ok: false });
      });
      child.on("exit", () => {
        const localBin = path.join(electron.app.getPath("home"), ".local", "bin");
        const parts = (process.env.PATH ?? "").split(":");
        if (!parts.includes(localBin)) process.env.PATH = [localBin, ...parts].join(":");
        resolve({ ok: claudeCanRun() });
      });
    });
  });
  registerChatIpc();
  registerStorageIpc();
  electron.ipcMain.handle("fs:openPath", async (_e, { path: path2 }) => {
    if (!path2) return { ok: false, error: "no path" };
    const err = await electron.shell.openPath(path2);
    return err ? { ok: false, error: err } : { ok: true };
  });
  const portLockFile = path.join(DATA_DIR, "port.lock");
  const existingLock = fs.existsSync(portLockFile) ? fs.readFileSync(portLockFile, "utf-8").trim().split("\n") : [];
  if (existingLock.length >= 2) {
    const oldPid = parseInt(existingLock[1]);
    try {
      process.kill(oldPid, 0);
      console.log(`[Hive] Warning: PID ${oldPid} still alive, overriding lock`);
    } catch {
    }
  }
  fs.writeFileSync(portLockFile, `${HIVE_PORT}
${process.pid}`);
  statusServer.listen(HIVE_PORT, "127.0.0.1", () => {
    console.log(`[Hive] Status server on http://127.0.0.1:${HIVE_PORT}`);
  });
  const STUCK_COUNT_FILE = path.join(DATA_DIR, "stuck-count.json");
  function loadStuckCounts() {
    try {
      if (fs.existsSync(STUCK_COUNT_FILE)) return JSON.parse(fs.readFileSync(STUCK_COUNT_FILE, "utf-8"));
    } catch {
    }
    return {};
  }
  function saveStuckCounts(counts) {
    try {
      fs.writeFileSync(STUCK_COUNT_FILE, JSON.stringify(counts));
    } catch {
    }
  }
  let stuckCounts = loadStuckCounts();
  const stuckNotifyCount = new Map(Object.entries(stuckCounts));
  setInterval(() => {
    const d = loadData();
    const tgs = d.taskGroups || [];
    for (const tg of tgs) {
      const tasks = listTasks(DATA_DIR, tg.projectId);
      const now = Date.now();
      const project = (d.projects || []).find((p) => p.id === tg.projectId);
      const projectName = project?.name || tg.projectId;
      for (const task of tasks) {
        if (task.status !== "assigned" && task.status !== "in_progress" || !task.assignedAt) continue;
        if (task.owner && limitResets.has(task.owner)) continue;
        if (task.status === "done" || task.status === "blocked" || task.status === "abandoned") {
          stuckNotifyCount.delete(task.id);
          continue;
        }
        const elapsed = (now - new Date(task.assignedAt).getTime()) / 6e4;
        const limit = task.estimatedMinutes || 10;
        if (elapsed > limit) {
          const count = stuckNotifyCount.get(task.id) || 0;
          const workerAgent = (d.agents || []).find((a) => a.id === task.owner);
          const workerName = workerAgent?.name || task.owner || "unknown";
          dispatchLog("stuck", `⏰ [${projectName}] ${task.id} "${task.title}" — ${Math.round(elapsed)}m elapsed (est. ${limit}m, notify ${count + 1}/3)`, task.owner || void 0);
          if (count < 3) {
            sendToAgent(task.owner, "MSG", { ping: task.id, message: `Task ${task.id} exceeded estimated time (${limit}m). Status?` });
            notifyHuman("Task Stuck", `[${projectName}] ${workerName} · ${task.id} "${task.title}" — ${Math.round(elapsed)}m (est. ${limit}m)`);
            stuckNotifyCount.set(task.id, count + 1);
            saveStuckCounts(Object.fromEntries(stuckNotifyCount));
          }
        }
      }
    }
  }, 6e4);
  setInterval(() => {
    const now = Date.now();
    for (const [agentId, info] of limitResets) {
      if (info.whipScheduled) continue;
      if (now < info.resetTime.getTime()) continue;
      info.whipScheduled = true;
      const term = terminals.get(agentId);
      if (!term) {
        dispatchLog("whip", `⚠️ Cannot whip ${agentId} — no terminal`, agentId);
        limitResets.delete(agentId);
        continue;
      }
      dispatchLog("whip", `🔄 Whipping ${agentId} — limit reset, resuming session`, agentId);
      notifyHuman("Agent Whip", `Auto-restarting agent after 5h limit reset`);
      term.write("\r");
      setTimeout(() => {
        const t = terminals.get(agentId);
        if (t) t.write("claude -c\r");
      }, 2e3);
      setTimeout(() => limitResets.delete(agentId), 1e4);
    }
  }, 3e4);
  function scheduleDailyReport() {
    const now = /* @__PURE__ */ new Date();
    const next = new Date(now);
    next.setHours(0, 1, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    const ms = next.getTime() - now.getTime();
    setTimeout(() => {
      const dateStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const d = loadData();
      const tgs = d.taskGroups || [];
      for (const tg of tgs) {
        if (!tg.dailyReportEnabled) continue;
        const sent = sendToAgent(tg.managerId, "HUMAN", { action: "daily-report", date: dateStr });
        dispatchLog("daily-report", `📋 Triggered daily report for ${dateStr}`, tg.managerId);
        if (!sent) dispatchLog("daily-report", `⚠️ Manager terminal offline — daily report not sent`, tg.managerId);
      }
      scheduleDailyReport();
    }, ms);
  }
  scheduleDailyReport();
  electron.app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });
  startPtyHealthMonitor();
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  for (const [, term] of terminals) {
    killProcessTree(term);
  }
  terminals.clear();
  const portLockFile = path.join(DATA_DIR, "port.lock");
  try {
    fs.unlinkSync(portLockFile);
  } catch {
  }
  if (process.platform !== "darwin") electron.app.quit();
});
