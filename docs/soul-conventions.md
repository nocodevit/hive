# Hive Soul.md 分区规范 v1

任何 agent（Hodas、Alex、Tracy、人类）按这份规则改 soul 内容，保证 Hive 升级 task-group 模板时不会冲突，user 手写的部分不会被覆盖。

---

## 0. 两种 role — 不同维度

**soul role**（永久身份 / 职业）：写在 user soul 里
- 例：Alex(data) 是 **Senior Software Engineer**（PSLE 数据 pipeline 方向）
- Tracy(Website) 是 **Senior Frontend Engineer**（PSLE Web）
- Hodas 是 **Critic / Code Reviewer**

**task-group role**（情境角色 / 当下任务）：仅当 agent 加入某 task-group 时存在；放在 marker 区
- 例：Alex(data) 加入 PSLE batch task-group 时充当 **Worker**
- 不在 task-group 时，marker 区为空 OR 整个 marker 块不存在

**任何 agent 都可以同时有 soul role + task-group role**，互不冲突。soul role 描述"你是谁"，task-group role 描述"这个 batch 你扮演什么"。

---

## 1. 三个名词

| 名词 | 实际是什么 | 在哪 |
|------|------------|------|
| **user soul** | 你在 Hive UI 那个 "Soul" 文本框里打的字（Identity / soul role / Workflow / Boundaries / Skills 都在这里） | 存到 `~/.hive/data.json` 里 `agents[i].soul` 字段 |
| **agent .md 文件** | Hive 启动时自动生成给 claude 加载的 agent 定义 | `<project-cwd>/.claude/agents/hive-agent-XXX.md` |
| **marker** | 一对 HTML 注释行（`<!-- hive:taskgroup:begin v=1 -->` ... `<!-- hive:taskgroup:end -->`），把 .md 文件里 hive 自动生成的 task-group 编排部分包起来 | 在 `.md` 文件里 |

**数据流**：

```
你在 Hive UI 编辑 Alex(data) 的 Soul 文本框
       ↓ 点保存
~/.hive/data.json    ← agents[i].soul = "你是 Alex(data) Senior Engineer ..."
       ↓ Hive 重启 / agent 配置改 / 加入 task-group
writeAgentDefinition() 读 data.json 里的 soul，拼出完整 .md
       ↓ writeFileSync
<cwd>/.claude/agents/hive-agent-1774186235213.md
       ↓ claude 启动时读它
claude --print --agent hive-agent-XXX  ← 加载 .md 内容当 system prompt
```

**关键**：user soul 在 `data.json` 里，**不在 .md 里**。.md 每次 Hive 启动重新拼。

---

## 2. 文件骨架（agent .md 拼出来后长这样）

**重要**：marker 块在 **底部**（user 内容之后）。理由：claude 先读人设/技能/边界（永久身份），最后读 task-group 编排（情境角色）— 顺序符合"我是谁 → 当下要做什么"。

```markdown
---
name: hive-agent-XXX
description: ...
hooks: ...                    ← lifecycle hooks（PreToolUse / Stop curl 上报）
---

# Identity
{你是谁，1-2 句}

## Role
{soul role：Senior Engineer / Designer / Reviewer，永久职业身份}

## Workflow
{Plan → Implement → Build → Test → Commit → Summary 等}

## Required reading
{handbook、约定、project docs}

## Skills (load on demand via Skill tool)
{available skill paths}

## Boundaries
{scope / 不能做什么 / 拒绝越界、转给谁}

<!-- hive:taskgroup:begin v=1 -->
{task-group role + Worker / QA / Manager / Critic 工作循环 — Hive 自动生成 + 维护}
<!-- hive:taskgroup:end -->
```

**不可变规则**：
- **marker 块（`<!-- hive:* -->`）= Hive 写**：每次重新生成 .md 时由 `writeAgentDefinition()` 自动填，agent / user 都不要手改 .md 里这部分
- **marker 块外 = user 写**：来自 `~/.hive/data.json` 里 `agents[i].soul` 字段；user 在 Hive UI 编辑面板写的内容；Hive 永远不动

---

## 3. Marker 语法（必须严格）

```
<!-- hive:<namespace>:begin v=<n> -->
...内容...
<!-- hive:<namespace>:end -->
```

- `<namespace>` ∈ `taskgroup`（未来扩展：`gates` 等）
- `v=<n>` 整数版本号，Hive 升级模板时 bump
- begin / end 必须各占一行
- 同一 .md 文件每个 namespace 最多出现一次
- **位置**：marker 块**整体**放 user soul 之后（文件底部）

---

## 4. marker 区装什么

### `hive:taskgroup` (v=1)

仅当 agent 加入 task-group 时由 Hive 自动填。装 4 类内容：

1. **task-group role 名称**（Worker / QA / Manager / Critic）
2. **工作循环**（agent 主动需要做的 step-by-step semantic 行为）
3. **接口调用**（`hive-report.sh` 等编排脚本，必须 agent 主动调，hooks 替不了）
4. **硬约束**（NEVER exit / NEVER outside scope 等）

模板（以 Worker 为例）：

```markdown
<!-- hive:taskgroup:begin v=1 -->
## Hive Orchestration — Worker

1. Poll for tasks: `.claude/hive-report.sh check-inbox` — returns JSON with pending messages. Also triggered by [HIVE:INBOX] nudge.
2. Parse task from inbox: note the id, title, scope, verify[]
3. Execute the task
4. Run ALL verify[] commands yourself. Read the full output. If any fail, fix and re-run until they pass.
5. Self-check scope: `git diff --name-only origin/main...HEAD` — confirm only scope files changed before task-done.
6. Call `.claude/hive-report.sh task-done TASK_ID "summary"`. System sends scope warning if files are outside scope — informational only, NOT blocking.
7. If stuck on task after 3 attempts: `.claude/hive-report.sh task-blocked TASK_ID "reason"`
8. On done → `.claude/hive-report.sh ready` → `/clear` → wait for next [HIVE:TASK]

NEVER exit. NEVER work outside scope. [HIVE:HUMAN] = follow immediately.
<!-- hive:taskgroup:end -->
```

**注意**：lifecycle hooks（PreToolUse / Stop curl 上报）走 YAML frontmatter，不写在 marker 里。**Semantic orchestration 调用**（task-done with summary、task-blocked with reason、check-inbox polling）写在 marker 里是合理的 — hooks 只能在 lifecycle 触发器上跑，做不到带 context 的语义事件。

---

## 5. user soul 该写什么（marker 外）

| Section | 内容 |
|---------|------|
| `# Identity` | 1-2 句你是谁 |
| `## Role` | **soul role**（Senior Engineer / Designer / Reviewer）— 永久职业身份。**不写 Worker / QA 等 task-group role** |
| `## Workflow` | 工作流 — code ops / data ops / 等 domain 行为 |
| `## Required reading` | 项目 handbook / 关键 docs |
| `## Skills` | 可加载 skill 的 menu（load on demand） |
| `## Boundaries` | scope / 拒绝什么 / 转给谁 |

绝对不写：
- ❌ task-group role（Worker / QA — 那是 marker 区的事，仅在加入 task-group 时由 Hive 注入）
- ❌ hive-report.sh 调用（Hive 自动注入到 marker 区）
- ❌ agentId / sessionId / hive port — infra
- ❌ pipeline 拓扑（"QA 之后 Critic 来"）— 跟 soul role 无关

---

## 6. 内容审计 checklist

| 问题 | 答案 | 去哪里 |
|------|------|--------|
| 这是 task-group 编排（Worker 循环 / QA gate / Manager 派活）吗？ | YES | marker 区（Hive 自动生成）|
| 这是 lifecycle 事件（spawn / start tool / stop turn）吗？ | YES | hooks frontmatter（自动） |
| 这是永久职业身份 / 工作流 / domain 知识吗？ | YES | user soul（Identity / Role / Workflow） |
| 这是 infra plumbing（URL / port / sid）吗？ | YES | hooks frontmatter（不写在文档可见处） |

---

## 7. 4 种 task-group role v=1 模板

### Worker

```markdown
<!-- hive:taskgroup:begin v=1 -->
## Hive Orchestration — Worker

1. Poll for tasks: `.claude/hive-report.sh check-inbox`
2. Parse task: id, title, scope, verify[]
3. Execute
4. Run ALL verify[] yourself
5. Self-check: `git diff --name-only origin/main...HEAD`
6. Call `.claude/hive-report.sh task-done TASK_ID "summary"`
7. If stuck: `.claude/hive-report.sh task-blocked TASK_ID "reason"`
8. On done → `.claude/hive-report.sh ready` → `/clear` → wait for next [HIVE:TASK]

NEVER exit. NEVER work outside scope. [HIVE:HUMAN] = follow immediately.
<!-- hive:taskgroup:end -->
```

### QA

```markdown
<!-- hive:taskgroup:begin v=1 -->
## Hive Orchestration — QA

1. Poll for review tasks: `.claude/hive-report.sh check-inbox`
2. For each Worker task ready for review:
   - Read worker's verify.md
   - Run G1-G8 gates locally if applicable
   - pass → `.claude/hive-report.sh review-pass TASK_ID "approval note"`
   - fail → `.claude/hive-report.sh review-fail TASK_ID "reasons + suggestions"`
3. Never edit Worker's question files; only emit review verdicts
4. On idle → `.claude/hive-report.sh ready` → wait for next [HIVE:REVIEW]
<!-- hive:taskgroup:end -->
```

### Manager

```markdown
<!-- hive:taskgroup:begin v=1 -->
## Hive Orchestration — Manager

1. Read `<todoSource>` to understand pending work
2. Slice into batches; dispatch each task: `.claude/hive-report.sh dispatch TASK_ID worker_id "task json"`
3. Watch QA verdicts: `.claude/hive-report.sh check-results`
   - pass → mark done; advance batch
   - fail → re-dispatch with fix hints, OR escalate to user if 3 retries fail
4. On batch completion: `.claude/hive-report.sh batch-done BATCH_ID`
5. Never edit question files; only orchestrate

NEVER exit. Watch for [HIVE:HUMAN] for redirects.
<!-- hive:taskgroup:end -->
```

### Critic

```markdown
<!-- hive:taskgroup:begin v=1 -->
## Hive Orchestration — Critic

1. Triggered by Manager via `.claude/hive-report.sh check-inbox` (subset of QA-passed tasks Manager wants double-checked)
2. Read related question files + audit trail
3. Cross-batch consistency / style / long-term quality
4. Verdict: `.claude/hive-report.sh critic-pass TASK_ID "ok"` OR `.claude/hive-report.sh critic-revise TASK_ID "concerns"`
5. Critic only advises; Manager decides final merge
<!-- hive:taskgroup:end -->
```

---

## 8. Hive 后端职责（writeAgentDefinition 应该做）

> v1.7.93 还没完全实现 — 当前 `writeAgentDefinition` 把 task-group addendum **append 到 user soul 之后但没 marker 包裹**。
>
> 目标：marker 包裹 + 仅在 task-group agent 时插入。

```js
let mdContent = yamlFrontmatter + '\n\n' + config.soul   // user soul 不带 marker，原样拼

if (config.taskGroupRole) {
  mdContent += '\n\n<!-- hive:taskgroup:begin v=1 -->\n'
  mdContent += getTaskGroupSection(config.taskGroupRole, config.taskGroupContext)
  mdContent += '\n<!-- hive:taskgroup:end -->\n'
}
```

`agents[i].soul` 在 `~/.hive/data.json` 里：
- 永远只存 marker 之外的 user 内容（Identity / Role / Workflow / Boundaries / Skills）
- Hive UI 编辑面板只暴露 user soul（marker 区是 Hive 后端拼时自动生成）
- agent 加入 / 离开 task-group → 只是 marker 区出现 / 消失 → user soul 字段一字不动
- Hive 升级 task-group 模板（v=1 → v=2） → 改 `getTaskGroupSection()` → 下次 spawn 自动用新版

---

## 9. 迁移：把老 user soul 改到 v=1

针对 `~/.hive/data.json` 里 `agents[i].soul` 字段：

1. **打开 Hive UI** → 找 agent → 编辑 Soul 文本框
2. **抽出 task-group 描述**（"我是 Worker，每次循环..."这类）→ 删掉，因为 Hive marker 区会自动注入
3. **抽出 hive-report.sh 调用**、**curl 上报**、**agentId 等 infra** → 删掉
4. **重写**符合"Identity / Role(soul role) / Workflow / Required reading / Skills / Boundaries"骨架
5. **soul role 用永久职业身份**（Senior Engineer / Designer / Reviewer），**不要写 Worker / QA**
6. **不要在 Soul 文本框里写 marker** — marker 是 Hive 后端拼 .md 时自动加
7. **保存** → `~/.hive/data.json` 更新 → 下次 spawn agent 时 Hive 拼新 .md

---

## 10. Diff 示例（Alex(data)）

### Before（Soul 文本框里把 task-group 编排和 soul role 混在一起）

```markdown
# Identity
You are Alex(data).

## Role
Worker for PSLE batch tasks. Senior software engineer.

## Hive Orchestration
1. Poll inbox via .claude/hive-report.sh check-inbox
2. Execute task
3. Call .claude/hive-report.sh task-done ...
8. On done /clear ...

## Workflow
6-step dev loop ...
```

### After（user soul 纯 domain；task-group 编排归 marker 区）

user soul 文本框（存到 data.json）：
```markdown
# Identity
You are Alex(data).

## Role
Senior software engineer. Default scope: PSLE Alex question-bank pipeline ...

## Workflow
**Code changes**: 6-step dev loop ...
**Data ops**: 4-step audit-fix-audit-push cycle ...

## Required reading
- regen-batch2-handbook.md ...

## Skills
- dev/* ...
- data/task-* ...

## Boundaries
- Question-bank scope only ...
```

Hive 后端拼 .md 时自动加 marker 区（user 看不见这步）：
```markdown
<!-- hive:taskgroup:begin v=1 -->
## Hive Orchestration — Worker
1. Poll for tasks ...
8. On done /clear ...
<!-- hive:taskgroup:end -->
```

最终 .md = user soul 内容 + 末尾 marker 区。

---

## 11. 版本升级流程

将来 task-group 加新职责（如 Manager 加 batch-archive 步骤）：

1. 在 `getTaskGroupSection()` 里写 v=2 模板
2. bump marker 版本：`<!-- hive:taskgroup:begin v=2 -->`
3. Hive 启动 / agent 配置保存时，writeAgentDefinition 自动用 v=2 内容
4. user 那侧零感知 — 不需要改 Hive UI 里的 Soul 文本框

---

## 12. 决策记录

- **2026-04-30**: v=1 出炉
- 决定 marker 用 HTML comment（`<!-- hive:NS:begin v=N -->`）
  - markdown 渲染时不可见、claude system prompt 中可见、易 regex match、有 namespace + 版本字段
- 决定 marker 位置 = **底部**（user 内容之后）
  - claude 先读人设/技能/边界（持久身份），最后读 task-group 编排（情境角色）— 顺序符合"我是谁 → 当下要做什么"
- 决定**两种 role 严格分开**：
  - soul role（Senior Engineer / Designer 等永久身份）→ user soul `## Role` 段
  - task-group role（Worker / QA / Manager / Critic 情境角色）→ marker 区，仅 task-group agent 才有
- semantic orchestration（task-done with summary、check-inbox polling）写在 marker 区合理 — hooks 只能 lifecycle，覆盖不了带 context 的事件
