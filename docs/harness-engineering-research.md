# Harness Engineering: Building Reliable AI Agent Systems

## A Research Synthesis (March 2026)

---

## 1. Executive Summary

**Harness engineering** is the discipline of designing, building, and operating the infrastructure that constrains, informs, verifies, and corrects AI agents in production. If 2025 was the year AI agents proved they could write code, 2026 is the year the industry learned that **the agent is not the hard part -- the harness is.**

The term draws from equestrian tack -- reins, saddle, bit -- the complete equipment for channeling a powerful but undirected animal. The AI model is the horse: fast, capable, but it does not know where to go on its own. The harness is everything that makes it useful.

**Key thesis:** Reliability in agentic systems comes overwhelmingly from the environment surrounding the model, not from the model itself. Harness engineering delivers **50-80% reliability improvements**, compared to 5-15% from prompt refinement alone. LangChain improved task completion from 52.8% to 66.5% through harness changes without upgrading the model. Vercel achieved 80% to 100% accuracy by reducing available tools from 15 to 2 while cutting token consumption by 37%.

This document synthesizes research from Anthropic, OpenAI, Google, Microsoft, Martin Fowler, and dozens of production deployments to define harness engineering as a coherent discipline with identifiable patterns, metrics, and best practices.

---

## 2. Definition and Taxonomy

### 2.1 Harness vs Agent vs Workflow vs Pipeline

| Concept | Definition | Determinism | Flexibility |
|:--------|:-----------|:------------|:------------|
| **Pipeline** | Fixed sequence of operations. No LLM decision-making. | Fully deterministic | None |
| **Workflow** | LLMs and tools orchestrated through *predefined code paths*. Steps are known in advance. | High (code controls flow) | Low |
| **Agent** | LLM *dynamically directs its own processes and tool usage*. Steps are determined at runtime. | Low (model controls flow) | High |
| **Harness** | The infrastructure that *contains and empowers* workflows and agents: tools, permissions, memory, hooks, verification, context management. | The harness itself is deterministic | Configurable |

The harness is the invariant layer. Agents and workflows are execution patterns that run inside it. A harness without an agent is an empty runtime. An agent without a harness is an uncontrolled language model.

### 2.2 Where Harness Engineering Sits in the AI Stack

Harness engineering is the broader discipline that encompasses context engineering along with tool orchestration, state management, verification, human-in-the-loop controls, and lifecycle management. Context engineering -- the practice of dynamically assembling what an agent needs at each step -- is one component of harness engineering, not a synonym for it.

### 2.3 The Harness as Runtime Environment

Martin Fowler frames the harness as "the tooling and practices we can use to keep AI agents in check." His analysis of the OpenAI Codex team (which built a production application exceeding 1 million lines of code with zero human-written lines over 5 months) identifies three core components:

1. **Context engineering** -- continuously enhanced knowledge bases plus dynamic context access
2. **Architectural constraints** -- deterministic linters, structural tests, module boundary enforcement
3. **Garbage collection** -- periodic agent runs to detect inconsistencies and architectural violations

The key insight: "When the agent struggles, we treat it as a signal: identify what is missing -- tools, guardrails, documentation -- and feed it back into the repository."

---

## 3. Core Principles

### 3.1 Separation of Concerns: Agent Thinks, Harness Controls

The most fundamental principle in harness engineering is the strict separation between advisory guidance and deterministic enforcement.

- **Advisory guidance** (system prompts, instruction files, CLAUDE.md) tells the agent what it *should* do. Compliance is probabilistic -- approximately 80%.
- **Deterministic enforcement** (hooks, permission systems, schema validation) tells the agent what it *can* do. Compliance is 100% because the harness enforces it programmatically.

**Corollary:** If something must happen every time, it must not be a prompt instruction. It must be a hook, a permission rule, or a programmatic gate.

### 3.2 Deterministic Enforcement vs Advisory Prompting

| Mechanism | Compliance | Use For |
|:----------|:-----------|:--------|
| System prompts | ~80% | Style preferences, coding conventions, general approach |
| Instruction files | ~80% | Project context, architecture decisions, best practices |
| Hooks (pre/post tool use) | 100% | Auto-formatting, file protection, security enforcement |
| Permission systems | 100% | Tool access control, file write restrictions |
| Schema validation | 100% | Output format requirements, API contract enforcement |
| Cost envelopes | 100% | Budget limits, iteration caps |

### 3.3 Composable Instruction Layers

Production harnesses use a hierarchy of instruction layers, from most general to most specific:

```
Global (organization policy)
  -> User (personal preferences)
    -> Project (team conventions)
      -> Path-specific (file-type rules)
        -> Agent-specific (role instructions)
          -> Task-specific (current objective)
```

Each layer adds context without overriding higher layers. The principle of progressive disclosure applies: load only what is needed for the current task. Keep persistent instructions concise (under 200 lines) and defer task-specific knowledge to on-demand loading.

### 3.4 Tool-as-Capability-Boundary

An agent's reliability is bounded by its tools. Anthropic's engineering team reports spending "more time optimizing tools than the overall prompt" in their SWE-bench implementation. Key principles:

- **Minimal, non-overlapping tool sets.** A human should be able to definitively say which tool to use for any given need. Vercel improved accuracy from 80% to 100% by reducing tools from 15 to 2.
- **Helpful error responses.** Tool errors should guide agents toward solutions, not present opaque tracebacks. Tool errors become teaching moments.
- **Token-efficient output.** Replace UUIDs and MIME types with semantic language. Implement pagination with sensible defaults.
- **Poka-yoke (mistake-proofing).** Use absolute paths instead of relative. Design argument schemas that make incorrect usage structurally impossible.

### 3.5 Memory and State Persistence Across Sessions

Agents must work in discrete sessions, each beginning with zero conversational memory. Most complex projects cannot complete in one context window. The solution is file-based state:

- **Progress files** (JSON format) track completed work, failed approaches, and next steps
- **Git commits** serve as checkpoints with descriptive messages
- **Feature lists** (JSON, not Markdown -- JSON resists unintended agent modification) enumerate discrete, testable deliverables
- **Auto-memory** systems capture build commands, debugging insights, and architecture notes between sessions

**Key insight:** Prefer file-based state over conversational state. Files survive compaction, session boundaries, and agent restarts. Conversation context does not.

---

## 4. Architecture Patterns

### 4.1 Prompt Chaining

**Description:** Decompose a task into sequential steps. Each LLM call processes the output of the previous one. Programmatic gates between steps verify intermediate results.

```
Input -> [Step 1: Generate] -> [GATE: validate] -> [Step 2: Refine] -> [GATE: test] -> Output
```

**When to use:** Tasks with well-defined sequential stages where intermediate validation is possible.

**Real-world example:** Code generation pipelines where Step 1 generates a plan, a gate validates the plan schema, Step 2 implements the plan, and a gate runs tests before accepting.

**Source:** Anthropic, "Building Effective AI Agents" (Dec 2024)

### 4.2 Routing / Dispatch

**Description:** Classify input and direct to specialized downstream handlers. Each handler has a focused prompt optimized for its category.

```
                      ┌──> [Bug Fix Agent]
Input -> [Classifier] ├──> [Feature Agent]
                      ├──> [Refactor Agent]
                      └──> [Review Agent]
```

**When to use:** When different input categories benefit from specialized handling. A bug fix needs different tools and instructions than a new feature.

**Real-world example:** Factory.ai's Droid system routes tasks to specialized agents (CodeDroid for implementation, Review Droid for PR review, QA Droid for testing).

**Source:** Anthropic, "Building Effective AI Agents"; Factory.ai production architecture

### 4.3 Parallelization (Fan-Out / Fan-In)

**Description:** Two variants:
- **Sectioning:** Independent subtasks run concurrently, results merged
- **Voting:** Same task runs N times, results aggregated for confidence

```
                ┌──> [Agent A: Module 1] ──┐
Input -> [Split]├──> [Agent B: Module 2] ──├──> [Merge] -> Output
                └──> [Agent C: Module 3] ──┘
```

**When to use:** Tasks with independent subtasks (sectioning) or high-stakes decisions where consensus improves confidence (voting).

**Real-world example:** Anthropic's C compiler project used 16 parallel Claude instances, each in Docker containers, cloning from a central git repository. Result: 100,000-line compiler, ~2,000 sessions, 2 weeks, $20,000.

**Source:** Anthropic, "Building a C Compiler with Parallel Claudes" (2026)

### 4.4 Orchestrator-Worker

**Description:** A central LLM dynamically breaks down tasks, delegates to worker LLMs, and synthesizes results. Unlike parallelization, subtasks are determined dynamically based on the specific input.

```
                           ┌──> [Worker A] ──┐
Input -> [Orchestrator] ───├──> [Worker B] ──├──> [Orchestrator] -> Output
                           └──> [Worker C] ──┘
```

**When to use:** Complex, unpredictable tasks where the step count and nature cannot be predetermined.

**Real-world example:** Claude Code Agent Teams: a team lead spawns 3-5 teammates, each with its own context window, coordinates through a shared task list with dependency tracking. The lead dynamically assigns work, reviews results, and synthesizes.

**Source:** Anthropic, "Building Effective AI Agents"; Claude Code Agent Teams (Feb 2026)

### 4.5 Evaluator-Optimizer Loop

**Description:** One LLM generates a response. A *different* LLM evaluates it against explicit criteria and provides feedback. The generator revises based on feedback. Loop continues until quality threshold is met.

```
┌─────────────┐     generates      ┌─────────────┐
│  Generator   │ ────────────────> │   Output     │
│  Agent       │                   │              │
└─────────────┘                   └──────┬───────┘
       ^                                 │
       │ feedback                        │ evaluates
       │                                 v
┌──────┴──────┐                   ┌─────────────┐
│  Revised     │ <────────────── │  Evaluator   │
│  Output      │    critique      │  Agent       │
└─────────────┘                   └─────────────┘
```

**When to use:** High-stakes outputs where quality must meet specific criteria. The single most important pattern for preventing self-approval.

**Critical detail:** Use *different models* for generation and evaluation. Same-model evaluation tends toward leniency. "When asked to evaluate its own work, an AI model is a pathological optimist."

**Real-world example:** The evaluator-optimizer pattern is used by Amazon's agentic systems, Azure Logic Apps, and numerous production coding agent deployments. Anthropic's blog reports that this pattern alone transforms mediocre single-agent output ($9, 20 minutes) into genuinely polished applications ($200, 6 hours) -- a 20x cost increase buying dramatically higher reliability.

**Source:** Anthropic, "Building Effective AI Agents"; Epsilla, "The GAN-Style Agent Loop"

### 4.6 Generator-Evaluator (GAN-Style)

**Description:** An extension of the evaluator-optimizer pattern inspired by Generative Adversarial Networks. The evaluator is armed with verification tools (Playwright for browser testing, test runners, linters) and scores against calibrated rubrics with few-shot examples.

```
[Generator] ──> [Output] ──> [Evaluator + Tools] ──> Pass? ──> Done
                                       │                 │
                                       │ No               │ Yes
                                       v                 v
                              [Feedback + Score]      [Accept]
                                       │
                                       v
                              [Generator Revises]
```

**When to use:** Application development where the evaluator must verify the *running* system, not just static code. The evaluator exercises live UI, APIs, and database state.

**Scoring rubric example (UI):**

| Dimension | What It Measures |
|:----------|:-----------------|
| Design Quality | Coherence, distinct visual identity |
| Originality | Custom decisions vs templated patterns |
| Craft | Typography, spacing, contrast, polish |
| Functionality | Usability, task completion |

**Source:** Anthropic, "Harness Design for Long-Running App Development"; Epsilla analysis

### 4.7 Sprint Contract

**Description:** Before implementation begins, the generator and evaluator negotiate a *contract* specifying: (1) what will be built, (2) how success will be verified, and (3) hard pass/fail thresholds. The evaluator then exercises the running application against these criteria.

```
[Negotiation Phase]
  Generator proposes deliverables
  Evaluator proposes acceptance criteria
  Both agree on thresholds
                │
                v
[Implementation Phase]
  Generator builds to contract
  Evaluator tests against contract
  Loop until contract satisfied or budget exceeded
```

**When to use:** Multi-feature application development where scope creep is a risk.

**Real-world example:** Anthropic's three-agent architecture for full-stack development uses sprint contracts to prevent vague "looks good" evaluations. Example evaluator output: "Rectangle fill tool allows click-drag to fill area with selected tile -- FAIL. Tool only places tiles at drag start/end points."

**Source:** Anthropic, "Harness Design for Long-Running App Development"

### 4.8 Ralph Loop (Atomic Pick-Implement-Validate-Commit-Reset)

**Description:** An atomic task execution cycle designed for stateless-but-iterative work. Each iteration is self-contained, avoiding context overflow while maintaining continuity through external artifacts.

```
┌─────────────────────────────────────────┐
│  1. Pick next task from task list       │
│  2. Implement change                    │
│  3. Validate (tests, lint, types)       │
│  4. Commit if passing                   │
│  5. Reset context; repeat from step 1   │
└─────────────────────────────────────────┘
```

**When to use:** Long-running projects that exceed context windows. Each loop iteration starts fresh but inherits progress through git history, progress logs, and task state files.

**Key property:** The agent's context is expendable. All essential state is in the filesystem and git. This enables indefinite operation without context window limits.

**Source:** Addy Osmani, "The Code Agent Orchestra"

### 4.9 Two-Agent (Initializer + Coder)

**Description:** For extended tasks spanning multiple context windows, two specialized agents divide the work:

**Initializer Agent (first session):**
- Creates `init.sh` for environment setup
- Creates `progress.txt` for tracking completed work
- Generates comprehensive feature list (JSON, all marked "failing" initially)
- Makes initial git commit

**Coding Agent (every subsequent session):**
- Reads git logs and progress files for context
- Runs smoke tests to catch undocumented breakage
- Works on single highest-priority incomplete feature
- Commits with descriptive message
- Updates progress documentation

**When to use:** Projects that require many sessions to complete. The initializer sets up the scaffolding; the coder does the work.

**Key insight:** JSON feature lists resist unintended modification better than Markdown. Agents modify only the `passes` field.

**Source:** Anthropic, "Effective Harnesses for Long-Running Agents"

### 4.10 Three-Agent (Planner + Generator + Evaluator)

**Description:** Three specialized agents manage continuous sessions:

1. **Planner:** Converts brief prompts into comprehensive specifications. Emphasizes scope ambition, avoids granular technical details that cascade into errors.
2. **Generator:** Implements features incrementally. Version control via git. With sufficiently capable models, runs continuously without explicit sprint decomposition.
3. **Evaluator:** Automated QA using browser automation (Playwright). Navigates running applications, exercises UI features, validates endpoints.

```
User Brief -> [Planner] -> Specification -> [Generator] -> Code -> [Evaluator]
                                                                       │
                                                              Pass? ───┤
                                                              │        │
                                                              No       Yes
                                                              │        │
                                                              v        v
                                                         [Feedback]  [Ship]
```

**When to use:** Full application development where quality must be high and scope is significant.

**Cost profile:** ~20x single-agent cost, but quality improvement is substantial for complex tasks.

**Source:** Anthropic, "Harness Design for Long-Running App Development"

---

## 5. Reliability Engineering

### 5.1 Loop Patterns

**Verification loops** check the agent's work at each step before allowing it to proceed. Two types:

- **Schema-based verification:** Validates output format and required fields. 50-150ms overhead per check. Catches structural errors instantly.
- **Semantic verification:** Uses a secondary LLM to evaluate deeper quality (correctness, completeness, style). More expensive but catches logical errors.

**Impact:** Verification loops alone improve task completion from 83% to 96%. They are described as "the single highest-ROI component" of a harness.

**Retry with backoff:** When verification fails, the agent receives feedback and retries. Best practice is forced reflection after 3 iterations: "What failed? What specific change would fix it?" This enables self-correction rather than endless identical attempts.

**Circuit breakers:** Hard iteration caps (recommended: 8 max per task per agent). After 3 identical failures on the same error, reassign the task to a different agent or escalate to a human. Cost ceilings at 3x estimated median per task serve as both budget controls and anomaly detection.

### 5.2 Cross-Model Review

**Never let an agent review its own output.** This is the most consistently emphasized principle across all research sources.

The structural separation between generator and evaluator forces adversarial dynamics. The evaluator has no incentive to be lenient -- its job is to find flaws. The generator cannot bypass the evaluator. Quality improves through genuine conflict.

**Best practices:**
- Use different models for generation and evaluation (e.g., Opus for generation, Sonnet for evaluation, or GPT-4.1 for generation, DeepSeek V3 for evaluation)
- At minimum, use a fresh context window -- the evaluator should have no memory of the generation process
- Give the evaluator access to verification tools (test runners, linters, browser automation)
- Score against explicit rubrics, not just "looks good"
- Calibrate evaluator judgment against human judgment iteratively

### 5.3 Deterministic Output Guarantees

**Schema validation:** Every structured output from an agent should pass schema validation before being accepted. This catches format errors that would cascade into downstream failures.

**Oracle testing:** Use a known-good implementation as a reference. Anthropic's C compiler project used GCC as an oracle -- randomly compiling files with GCC and using the agent's compiler for the rest, then narrowing down failures through binary search.

**Deterministic test sampling:** When full test suites are too slow, sample 1-10% of tests per agent run, deterministic per-agent but varied across instances. This provides probabilistic coverage without blocking velocity.

### 5.4 Evaluation Systems

Three grader types for evaluating agent output:

**Code-based graders (deterministic):**
- Does the code compile? Do tests pass? Does lint pass?
- Fast, objective, reproducible
- Brittle to valid variations

**Model-based graders (LLM judges):**
- Use rubrics for structured evaluation
- Handle nuance and open-ended quality assessment
- Require calibration against human judgment
- Can do pairwise comparisons (A vs B)

**Human graders (gold standard):**
- SME review for complex quality judgments
- Expensive, slow, but highest accuracy
- Used to calibrate model-based graders

**Key principle:** No single evaluation layer catches every issue. Combine automated evals, production monitoring, A/B testing, and human review. A 0% pass rate means a broken task, not an incapable agent. Read transcripts regularly to verify failures are authentic.

### 5.5 Guardrails

Production AI agents need defense in depth across three layers:

**Input layer:** Filter prompts before they reach the LLM. Block prompt injection, detect jailbreak attempts, validate task specifications.

**Logic layer:** Constrain agent behavior during execution. Enforce rate limits, prevent unauthorized tool calls, restrict file access via permission systems, apply cost envelopes.

**Output layer:** Validate responses before returning to users. Check structured output schemas, redact PII, filter hallucinations, run security scans.

**Risk-based routing:** Score each task's risk level and route accordingly:
- Low risk (score < 30): fully autonomous
- Medium risk (30-70): automated with verification gates
- High risk (> 70): human-in-the-loop required

**Hook-based enforcement:** Hooks fire at specific lifecycle points (pre/post tool use, session start/end, task creation/completion) and execute deterministic checks. Unlike prompt instructions (advisory), hooks are programmatic (mandatory). Common patterns:
- Auto-format after every file edit
- Block writes to protected files
- Run tests on every task completion
- Notify humans on specific events
- Verify completion before allowing "done" claims

### 5.6 Progress Tracking

**Deterministic artifacts** are the ground truth, not agent claims.

- **Git history** records every meaningful state change with descriptive commit messages
- **Progress files** (JSON) track completed steps, failed approaches, and next-session context
- **Feature lists** (JSON) enumerate all deliverables with pass/fail status per feature
- **Test results** are immutable -- tests created for a feature cannot be modified by the implementing agent

**Anti-pattern: Premature Victory.** Agents declaring "done" without verification. The fix is mandatory automated verification before any task can be marked complete. Check actual environmental state (do tests pass? does the build succeed?), never agent claims.

**Anti-pattern: Test Deletion.** Agents deleting or weakening tests to make their code pass. The fix is making tests immutable. Any test modification requires human approval or a separate agent with explicit "test maintenance" role.

---

## 6. Multi-Agent Coordination

### 6.1 Communication Mechanisms

| Mechanism | Latency | Reliability | Best For |
|:----------|:--------|:------------|:---------|
| **Shared filesystem** | High (polling) | Low (race conditions) | Simple state exchange, debugging |
| **IPC / Event bus** | Sub-millisecond | Medium (in-memory only) | Same-process coordination |
| **MCP (Model Context Protocol)** | Low (~10ms) | High | Agent-to-tool communication |
| **A2A (Agent-to-Agent Protocol)** | Medium (HTTP) | High | Cross-platform agent interop |
| **Message queue (Redis, RabbitMQ)** | Very low | Very high | High-throughput distributed systems |
| **Webhook / HTTP** | Low | Medium | Bridge between heterogeneous systems |
| **Git-based** | High (seconds) | High (audit trail) | Code artifact handoff |

**Practical recommendation:** For local multi-agent systems, combine IPC for internal coordination with MCP for agent-facing interfaces and SQLite for persistent state. External message brokers are overkill for desktop-scale deployments with 3-10 agents.

### 6.2 Task Distribution

**Shared task list:** A central data structure (typically JSON files on disk or a database) tracks all tasks with status (pending, in_progress, completed, blocked), owner, dependencies, and priority. Agents self-claim the next unblocked pending task.

**Assignment:** An orchestrator (either code-based or an AI agent) assigns tasks based on agent capabilities, current load, and task requirements.

**Claiming with locking:** File locks or database transactions prevent race conditions when multiple agents attempt to claim the same task simultaneously.

**Critical rule:** Never let two agents edit the same file. Conflicts kill velocity. Task decomposition must ensure file-level isolation between concurrent agents.

### 6.3 Conflict Resolution

**Worktree isolation:** Each agent works in its own git worktree on a dedicated branch. This provides complete filesystem isolation -- agents cannot accidentally overwrite each other's work.

**Branch-per-agent:** Each agent commits to its own branch. Merges happen through a controlled process (orchestrator-managed or PR-based).

**Merge protocols:** A designated "merge agent" or the orchestrator resolves conflicts. When conflicts are detected, the affected task is reassigned or escalated.

**Virtual machine isolation:** Devin uses isolated VMs per agent with sandboxed environments, supporting fork, rollback, and machine snapshots. This is the highest isolation level but also the most resource-intensive.

### 6.4 State Synchronization Across Agents

Agents have no shared memory or shared context. The only coordination channels are:

1. **Task state on disk** -- JSON files or database records tracking what each agent is working on
2. **Message systems** -- direct messaging between agents for ad-hoc coordination
3. **The repository itself** -- git commits, branches, and file contents serve as the canonical shared state
4. **Progress files** -- structured documents recording what has been completed and what was tried

**Research finding:** Academic surveys of 94 papers found that **hybrid communication** (centralized orchestration + decentralized peer messages) works best for software engineering tasks. Shared knowledge repositories reduce communication overhead and inconsistencies.

---

## 7. The Harness Stack

```
┌─────────────────────────────────────────────────────────────────┐
│  L4: UI / Management Layer                                      │
│  Dashboards, monitoring, human-in-the-loop interfaces,          │
│  task boards, agent analytics, cost tracking                    │
├─────────────────────────────────────────────────────────────────┤
│  L3: Orchestration Layer                                        │
│  Multi-agent coordination, team management, task scheduling,    │
│  dependency resolution, conflict resolution, merge protocols    │
├─────────────────────────────────────────────────────────────────┤
│  L2: Harness Layer                                              │
│  Instructions (CLAUDE.md, system prompts), hooks (pre/post      │
│  tool use, lifecycle events), permissions (allow/deny rules),   │
│  memory (auto-memory, progress files), skills (on-demand        │
│  instruction sets), verification loops, cost envelopes          │
├─────────────────────────────────────────────────────────────────┤
│  L1: Agent Runtime Layer                                        │
│  Tool calling, context window management, compaction,           │
│  subagent spawning, MCP client connections, model selection     │
├─────────────────────────────────────────────────────────────────┤
│  L0: LLM Layer                                                  │
│  Foundation models (Claude, GPT, Gemini, DeepSeek, Llama)       │
│  Capabilities: reasoning, code generation, planning, analysis   │
└─────────────────────────────────────────────────────────────────┘
```

**Layer interactions:**
- L0 provides raw intelligence. It has no agency without L1.
- L1 gives the model tools and manages its finite context window. It is the execution engine.
- L2 constrains and empowers L1. It is where reliability is engineered. This is the primary focus of harness engineering.
- L3 coordinates multiple L1+L2 instances. It handles the complexity of multi-agent work.
- L4 gives humans visibility and control. It closes the human-in-the-loop.

**Key insight:** Most reliability improvements come from L2. Most complexity comes from L3. Most effort should be spent on L2 before attempting L3.

---

## 8. Industry Implementations

### 8.1 Anthropic Claude Code

**Architecture:** Claude Code is Anthropic's reference harness implementation. It wraps Claude models with a complete environment:

- **CLAUDE.md** -- hierarchical instruction files (managed policy > user > project > path-specific rules) loaded at every session. Advisory (~80% compliance).
- **Hooks** -- 24+ lifecycle events with deterministic shell/HTTP/prompt/agent types. Exit code 0 = proceed, exit code 2 = block with feedback. The enforcement layer that instructions cannot be.
- **Skills** -- reusable instruction sets with YAML frontmatter. On-demand loading via progressive disclosure. Can define scoped hooks and tool restrictions.
- **Subagents** -- isolated context windows with custom system prompts and restricted tool access. Built-in types: Explore (Haiku, read-only), Plan, General-purpose, Bash.
- **Agent Teams** (experimental, Feb 2026) -- multiple independent Claude Code instances with shared task lists, file-locked claiming, inter-agent messaging, and dependency tracking. 3-5 teammates per team recommended.
- **Memory** -- auto-memory (Claude writes), CLAUDE.md (human writes), auto-dream (background agent that maintains memory between sessions).
- **MCP** -- open protocol connecting to external tools and data sources.

**Case study:** 16 parallel Claude instances built a 100,000-line C compiler over 2 weeks (~2,000 sessions, $20,000, 2B input tokens). Key patterns: task locking via files, infinite loop with fresh containers, deterministic test sampling, CI enforcement against regressions, progress documentation of failed approaches.

**Source:** [anthropic.com/research/building-effective-agents](https://www.anthropic.com/research/building-effective-agents), [anthropic.com/engineering/building-c-compiler](https://www.anthropic.com/engineering/building-c-compiler)

### 8.2 Cognition Devin

**Architecture:** A compound AI system (not a single model) with three specialized components:

- **Planner:** High-reasoning model that outlines strategy. Interactive planning -- researches codebase, develops detailed plan, allows human modification before autonomous execution.
- **Coder:** Specialized model trained on trillions of tokens of high-quality code.
- **Critic:** Adversarial model reviewing code for security vulnerabilities and logic errors before execution.

**Verification loop:** Every output runs through: `verify -> auto-fix -> re-verify -> escalate`. Hard gates on every output: spec exists, tests pass, coverage met, review clean, security scan clean, guardrails 0 violations.

**Key insight on circular behavior:** "If you ever find yourself thinking 'it's ignoring my instructions' or 'this thing is going in circles', you should be ok discontinuing that conversation." A fresh conversation with complete upfront instructions typically succeeds faster than correcting a derailed interaction.

**Isolation:** Uses isolated virtual machines per agent with sandboxed environments, supporting fork, rollback, and machine snapshots.

**Source:** [cognition.ai/blog/devin-annual-performance-review-2025](https://cognition.ai/blog/devin-annual-performance-review-2025), [devin.ai/agents101](https://devin.ai/agents101)

### 8.3 Factory.ai Droids

**Architecture:** Specialized droids for different workflow stages:
- **CodeDroid:** Implementation
- **Review Droid:** Pull request review
- **QA Droid:** Testing

**Orchestration:** "All real work happens in the Droids (sub-agents) it commands. This setup keeps autonomy predictable and costs low: reasoning is centralized, execution is distributed."

**Parallel execution:** Factory can script and parallelize Droids at massive scale for CI/CD, migrations, and maintenance. Rich orchestration design around when to parallelize vs sequence, how agents coordinate without overwhelming context windows, and how to converge multiple solution paths.

**Key principle:** "Control over the tools your agent uses is the single most important differentiator in agent reliability."

**Caveat:** Factory works best with mature teams that already have solid testing, code review, and repo hygiene. Without these, agents introduce more bugs than they solve.

**Source:** [factory.ai](https://factory.ai), [latent.space/p/factory](https://www.latent.space/p/factory)

### 8.4 OpenAI Swarm / Agents SDK

**Architecture:** Two primitives: Agents (instruction sets with tools) and Handoffs (transferring control between agents).

- **Routines:** A list of natural language instructions (system prompt) plus the tools necessary to complete them.
- **Handoffs:** When an agent can't handle a request, it calls a `transfer_to_XXX` function, returning an Agent object. Complete conversation history travels with the handoff.
- **Triage pattern:** An initial agent evaluates requests and routes to specialists.
- **Stateless execution:** The `run()` function takes messages, returns messages, saves no state between calls.

**Evolution:** Swarm was educational; replaced by the OpenAI Agents SDK (production-grade, March 2025) with active maintenance.

**Key design philosophy:** "By keeping agents lightweight, stateless, and bound by explicit handoff functions, Swarm trades opaque automation for clarity and observability."

**Source:** [github.com/openai/swarm](https://github.com/openai/swarm), [developers.openai.com/cookbook/examples/orchestrating_agents](https://developers.openai.com/cookbook/examples/orchestrating_agents)

### 8.5 Google A2A (Agent-to-Agent Protocol)

**Architecture:** Open protocol for agent interoperability across vendors, frameworks, and organizations.

- **Agent Cards:** JSON at `/.well-known/agent.json` advertising capabilities
- **Communication:** JSON-RPC 2.0 over HTTP(S), with gRPC support (v0.3+)
- **Task lifecycle:** submitted -> working -> input-required -> completed -> failed -> canceled
- **Multimodal:** Supports text, audio, and video streaming
- **Discovery:** Automatic via Agent Cards

**Ecosystem:** 150+ supported organizations as of July 2025. Co-housed with MCP under the Linux Foundation's Agentic AI Foundation (AAIF) as of June 2025.

**Relationship to MCP:** MCP is agent-to-tool (how agents access capabilities). A2A is agent-to-agent (how agents communicate with each other). They are complementary, not competing.

**Source:** [developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/), [github.com/a2aproject/A2A](https://github.com/a2aproject/A2A)

### 8.6 Framework Approaches

#### LangGraph

**Architecture:** Graph-based workflow where agent interactions are nodes in a directed graph. Supports conditional branching, cycles, and stateful execution via a centralized StateGraph.

**Orchestration patterns:** Supervisor (routes to workers), peer-to-peer (autonomous collaboration), pipeline (sequential processing). Parallelism via explicit fork/join nodes.

**Strengths:** Graph-first primitives, runtime graph mutation, recoverable workflows. Trusted by Klarna, Replit, Elastic.

**Source:** [langchain.com/langgraph](https://www.langchain.com/langgraph)

#### CrewAI

**Architecture:** Role-based model inspired by organizational structures. Four components: Agent (LLM unit with role/goal), Task (specific job), Crew (team), Tools (helper functions).

**Role types:** Manager (task distribution, progress monitoring), Worker (task execution), Researcher (information gathering). Natural task decomposition that reduces maintenance overhead.

**2025-2026 evolution:** Crews + Flows architecture. Flows enable event-driven control and single LLM calls for precise orchestration while supporting Crews natively.

**Source:** [crewai.com](https://crewai.com), [docs.crewai.com](https://docs.crewai.com)

#### Microsoft Agent Framework (AutoGen successor)

**Architecture:** Combines AutoGen's simple agent abstractions with Semantic Kernel's enterprise features. Graph-based workflows for explicit multi-agent orchestration.

**Key features:** Asynchronous messaging (event-driven and request/response), OpenTelemetry observability, session-based state management, type safety, middleware.

**Timeline:** AutoGen v0.4 adopted event-driven architecture. Microsoft Agent Framework 1.0 GA targeted end of Q1 2026. AutoGen and Semantic Kernel in maintenance mode.

**Source:** [learn.microsoft.com/en-us/agent-framework/overview/](https://learn.microsoft.com/en-us/agent-framework/overview/), [github.com/microsoft/autogen](https://github.com/microsoft/autogen)

---

## 9. Key Metrics

| Metric | Definition | Benchmark Range |
|:-------|:-----------|:----------------|
| **Task completion rate** | Proportion of tasks fully solved | 50-80% (SWE-bench Verified: Opus 4.5 at 80.9%) |
| **First-attempt success rate (pass@1)** | Tasks solved on first try without retries | 24% on professional tasks (APEX-Agents); higher on simpler benchmarks |
| **Verification loop count** | Average iterations before acceptance | 1-3 for routine tasks; 5+ indicates task complexity or specification issues |
| **Token efficiency** | Useful output per token consumed | Varies widely; context management can yield 3.5x improvement (Vercel) |
| **Time to completion** | Wall-clock time from task start to verified completion | Task-dependent; parallelization can reduce by 3-10x |
| **Regression rate** | Proportion of completed tasks that break existing functionality | Should be near 0% with CI enforcement; the C compiler project required stricter CI after agents repeatedly broke existing functionality |
| **Cost per task** | Total API spend per completed task | Highly variable; cost envelopes at 3x median are recommended |
| **Context utilization** | Percentage of context window used productively vs overhead | Auto-compaction typically triggers at ~95% capacity |

**Measurement guidance:**
- Agent performance is stochastic. Always report aggregated metrics across many trials.
- A 0% pass rate means a broken task, not an incapable agent.
- Read agent execution transcripts regularly to verify that failures are authentic and grading is accurate.

---

## 10. Best Practices Checklist

### Do

- [ ] Start with the simplest solution. Single LLM calls with retrieval often suffice.
- [ ] Add complexity only when it measurably improves outcomes.
- [ ] Separate generation from evaluation. Never let an agent review its own output.
- [ ] Use hooks for enforcement, prompts for guidance. If it must happen every time, it is a hook.
- [ ] Design tools with the same rigor as user-facing APIs. Fewer, non-overlapping tools outperform larger toolsets.
- [ ] Use file-based state (JSON progress files, git commits) over conversational state.
- [ ] Set hard iteration limits (8 max) with forced reflection at iteration 5.
- [ ] Implement cost envelopes at 3x estimated median per task.
- [ ] Make tests immutable. Agents cannot delete or weaken tests to make code pass.
- [ ] Use JSON over Markdown for structured state. JSON resists unintended modification.
- [ ] Start every session with smoke tests to catch undocumented breakage.
- [ ] Give evaluators access to verification tools (test runners, browser automation, linters).
- [ ] Keep persistent instructions concise (under 200 lines). Use progressive disclosure.
- [ ] Track progress via deterministic artifacts, not agent claims.
- [ ] Read agent execution transcripts regularly to identify systematic failures.
- [ ] Use worktree/branch isolation when multiple agents work on the same repository.

### Do Not

- [ ] Let an agent evaluate its own output (self-review anti-pattern)
- [ ] Run agents without iteration limits (unbounded loop anti-pattern)
- [ ] Allow agents to modify or delete tests (test deletion anti-pattern)
- [ ] Accept agent claims of completion without automated verification (premature victory anti-pattern)
- [ ] Dump full test outputs and stack traces into context (context pollution anti-pattern)
- [ ] Use vague task specifications without testable acceptance criteria (vague spec anti-pattern)
- [ ] Tune prompts without reading agent execution transcripts (ignoring transcripts anti-pattern)
- [ ] Let two agents edit the same file concurrently
- [ ] Rely on a single evaluation layer to catch all issues
- [ ] Deploy agents on codebases without solid testing, code review, and repo hygiene

---

## 11. Open Problems

### 11.1 Evaluator Calibration

How do you know your evaluator agent is correctly calibrated? Current practice requires iterative manual review: read evaluation logs, identify where evaluator judgment diverges from human judgment, update evaluator prompts, repeat. There is no automated solution for evaluator calibration at scale.

### 11.2 Context Window Limitations

Despite 1M-token context windows, complex projects still exceed capacity. Compaction (summarization) loses information. Subagent delegation adds coordination overhead. There is no lossless solution for maintaining full project understanding across sessions.

### 11.3 Non-Deterministic Failure Modes

Agent failures are stochastic. The same task with the same prompt may succeed or fail on different runs. This makes debugging, reproduction, and root cause analysis fundamentally harder than traditional software engineering. "Verification-aware planning" -- encoding pass-fail checks for each subtask so agents can proceed or halt on facts -- is an emerging research direction.

### 11.4 Cross-Agent State Consistency

When multiple agents modify the same codebase, maintaining consistency is hard. Worktree isolation helps but creates merge complexity. There is no established protocol for semantic conflict detection (two agents making logically incompatible changes to different files).

### 11.5 Cost Predictability

Agent costs are highly variable. A task estimated at $0.50 may cost $50 if the agent loops. Cost envelopes provide a ceiling but not a prediction. Better cost modeling for agentic workloads remains unsolved.

### 11.6 Long-Running Agent Memory

Despite auto-memory systems and progress files, agents still lose important context across sessions. Auto-dream (background maintenance of memory files) is a step forward, but the problem of maintaining coherent long-term project understanding across hundreds of sessions is fundamentally unsolved.

### 11.7 Harness Portability

Harness configurations (instruction files, hooks, permission rules) are currently vendor-specific. The Agent Skills standard provides cross-tool compatibility for prompt templates but not for enforcement mechanisms (hooks, permissions). A universal harness configuration format does not yet exist.

### 11.8 Architectural Convergence Pressure

Martin Fowler observes that effective harness engineering pressures teams toward fewer tech stacks and standardized codebase structures -- "AI-friendly architectures." The long-term implications of this convergence for software diversity and innovation are unknown.

### 11.9 Human-Agent Interface Design

How should humans monitor and intervene in multi-agent systems? Current interfaces range from terminal-only (Claude Code Agent Teams) to web dashboards. The optimal interaction model for human oversight of agentic work -- when to interrupt, how to redirect, what to surface -- remains an active design problem.

### 11.10 Evaluation of Evaluators

Who evaluates the evaluator? Model-based graders require calibration against human judgment, but human judgment is expensive and doesn't scale. There is a turtles-all-the-way-down problem with recursive evaluation that current approaches handle pragmatically but not theoretically.

---

## 12. References

### Anthropic Primary Sources

- [Building Effective AI Agents](https://www.anthropic.com/research/building-effective-agents) -- Canonical agent patterns guide (Dec 2024)
- [Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) -- Two-agent pattern, progress files, session management
- [Harness Design for Long-Running App Development](https://www.anthropic.com/engineering/harness-design-long-running-apps) -- Sprint contracts, GAN-style evaluator loop, three-agent pattern
- [Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) -- Context management, compaction, subagents
- [Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) -- Grader types, evaluation pipelines
- [Writing Effective Tools for AI Agents](https://www.anthropic.com/engineering/writing-tools-for-agents) -- Tool design, error handling, poka-yoke
- [Building a C Compiler with Parallel Claudes](https://www.anthropic.com/engineering/building-c-compiler) -- 16-agent parallel harness case study
- [Building Agents with the Claude Agent SDK](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk) -- SDK architecture and tool design principles
- [2026 Agentic Coding Trends Report](https://resources.anthropic.com/2026-agentic-coding-trends-report)

### Industry Analysis

- [Martin Fowler: Harness Engineering](https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html) -- Definition, three components, architectural convergence
- [What Is Harness Engineering?](https://harness-engineering.ai/blog/what-is-harness-engineering/) -- Five pillars framework, reliability statistics
- [The GAN-Style Agent Loop (Epsilla)](https://www.epsilla.com/blogs/anthropic-harness-engineering-multi-agent-gan-architecture) -- Generator-evaluator adversarial pattern
- [The Code Agent Orchestra (Addy Osmani)](https://addyosmani.com/blog/code-agent-orchestra/) -- Multi-agent coordination, Ralph Loop, quality gates
- [Agentic AI Coding Best Practices (CodeScene)](https://codescene.com/blog/agentic-ai-coding-best-practice-patterns-for-speed-with-quality) -- Code health metrics, coverage gates, safeguard patterns
- [OpenAI Harness Engineering](https://openai.com/index/harness-engineering/) -- Codex team's harness for million-line-scale development
- [NxCode: What Is Harness Engineering?](https://www.nxcode.io/resources/news/what-is-harness-engineering-complete-guide-2026) -- Complete guide (2026)
- [AgentBoard: What Is Harness Engineering?](https://agentboard.cc/blog/what-is-harness-engineering) -- Discipline overview

### Product and Framework Documentation

- [Cognition Devin: 2025 Performance Review](https://cognition.ai/blog/devin-annual-performance-review-2025) -- Hard gates, autofix loops
- [Devin Coding Agents 101](https://devin.ai/agents101) -- Self-verification loops, guardrails
- [Factory.ai](https://factory.ai) -- Droid architecture, parallel execution
- [Factory.ai on Latent Space](https://www.latent.space/p/factory) -- Architecture deep dive
- [OpenAI Swarm](https://github.com/openai/swarm) -- Agent handoff pattern
- [OpenAI: Orchestrating Agents](https://developers.openai.com/cookbook/examples/orchestrating_agents) -- Routines and handoffs
- [Google A2A Protocol](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/) -- Agent-to-agent interoperability
- [A2A GitHub](https://github.com/a2aproject/A2A) -- Protocol specification
- [LangGraph](https://www.langchain.com/langgraph) -- Graph-based agent orchestration
- [CrewAI](https://crewai.com) -- Role-based multi-agent framework
- [Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/overview/) -- AutoGen/Semantic Kernel convergence
- [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams) -- Subagent and teammate patterns
- [Model Context Protocol](https://modelcontextprotocol.io/specification/2025-11-25) -- Agent-to-tool open standard
- [Agent Skills Standard](https://agentskills.io) -- Cross-tool skill format

### Production Guardrails and Evaluation

- [AI Agent Guardrails: Production Guide 2026](https://authoritypartners.com/insights/ai-agent-guardrails-production-guide-for-2026/) -- Defense-in-depth framework
- [Agents at Work: 2026 Playbook](https://promptengineering.org/agents-at-work-the-2026-playbook-for-building-reliable-agentic-workflows/) -- Verification-aware planning
- [Amazon: Evaluating AI Agents](https://aws.amazon.com/blogs/machine-learning/evaluating-ai-agents-real-world-lessons-from-building-agentic-systems-at-amazon/) -- Real-world evaluation lessons
- [FeatureBench: Benchmarking Agentic Coding](https://arxiv.org/html/2602.10975v1) -- Task completion metrics
- [LLM-Based Multi-Agent Systems for SE (arxiv)](https://arxiv.org/abs/2404.04834) -- Survey of 94 papers on multi-agent patterns
- [Agentic Coding Recommendations (Armin Ronacher)](https://lucumr.pocoo.org/2025/6/12/agentic-coding/) -- Practical developer workflows
