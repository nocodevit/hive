# Butler API

Local HTTP routes that let a controller on the same machine drive Hive's
chats — built for `hive-butler` (a `claude remote-control` session the
owner reaches from a phone). Code: `src/main/butlerApi.ts` (pure helpers),
`handleButlerRequest` in `src/main/index.ts` (wiring).

Served by the existing status server: `http://127.0.0.1:<port>` where the
port is the first line of `~/.hive/port.lock`.

## Auth

- Header `X-Hive-Token: <contents of ~/.hive/api-token>` (created at
  startup, mode 600).
- Any request carrying an `Origin` header is refused (403). Together with
  the custom header this keeps web pages from reaching these routes.

## Routes

| Route | Purpose |
|---|---|
| `GET /agents` | Every agent: project, name, role, note, `chatLive`, `activity` (`working` / `waiting` / `off`) |
| `GET /chat/tail?agentId=…&n=10` | Last n readable items (user / assistant / tool / result) of that agent's chat log |
| `POST /chat/send` `{agentId \| project+agent, text}` | Type `text` into the chat. 409 `no_session` if the chat is not running — never auto-starts |
| `POST /chat/start` `{agentId \| project+agent, mode}` | Start the chat (`resume` = ctx-based resume / compact+resume, `new` = fresh). Waits until it is live |

Targets resolve by `agentId`, or by exact `agent` name (+ exact `project`
name when the agent name repeats). No fuzzy matching: `not_found` /
`ambiguous` come back with `candidates`.

## Behaviour notes

- A remote start mounts the pane the way "Whip lazy bones" does: it does
  not change the selected agent and never LRU-evicts another chat.
- A message sent through the API is written to claude's stdin by the same
  function the input box uses, and mirrored into the window as a user
  bubble (`chat:externalUser:<id>`).
- Hive must be running; these routes live in its main process.

## Built-in Butler (v2.28.0)

App Settings → Remote Control (the first section) → "Allow remote control
from my phone (Butler)", off by default.

- **Offer:** once, at launch, someone who already has agents and never
  answered gets "Control Hive from your phone?" (Turn on / Not now; after
  the resume-chats dialog if that shows). Either answer, or ever turning
  the switch on, is final (`butler.json` `offered`). "Turn on" opens App
  Settings so the status and the trust OK are in view. Creating the first
  agent never triggers it mid-flow. Skipped with an isolated
  `HIVE_DATA_DIR` (the e2e suites) unless `HIVE_BUTLER_OFFER=1`. Code: `src/main/butler.ts`, bundled files in
`resources/butler/` (shipped as `extraResources/butler`).

- **On:** Hive writes `CLAUDE.md` (rules), `hive` (the CLI) and
  `.claude/settings.json` into `~/.hive/butler/` (`$HIVE_DATA_DIR/butler`),
  overwriting them every start so upgrades ship new rules and local edits
  don't stick, then runs
  `claude remote-control --name "Hive Butler" --permission-mode dontAsk`
  there in a pty. It shows up as "Hive Butler" in the Claude app's Code
  list on the same account.
- **Permissions:** `dontAsk` refuses anything not allow-listed; the
  settings allow only `./hive agents|tail|send|start` and deny
  Edit/Write/NotebookEdit.
- **Prompts:** `remote-control` asks "Trust <folder>? [y/N]" (default No)
  and then "Enable Remote Control? (y/n)" on every start, even in a folder
  already trusted. Hive types `y` to the trust question itself only when
  both hold, checked at that start (not live for a running session):
  the owner clicked "Trust and continue" since the switch was last turned
  on (`butler.json` `trusted`; switching off clears it), and Claude Code's
  own record still trusts the folder (`hasTrustDialogAccepted` in
  `.claude.json`, read fresh, never written by Hive). Otherwise it waits
  for the click in Settings. The second question Hive always answers (the
  switch is the yes).
- **Status:** connected once the `https://claude.ai/code?environment=…`
  link is printed. A session that dies before connecting is shown as an
  error with its last output (e.g. not logged in) and is not retried in a
  loop. A connected session that exits is restarted with backoff (2 s,
  10 s, 30 s, 2 min; the budget resets after 10 min up).
- **Same session every time:** once connected, Hive reads the session id
  remote-control recorded in
  `~/.claude/projects/<slug>/bridge-pointer.json` (read only) and keeps it
  in `butler/.session-id`. Later starts use `--session-id <id>`, so the
  phone keeps one "Hive Butler" with its history however long Hive was
  closed. If that fails: `--continue` (works within ~4 h), then a new
  session. A butler left behind by a crash (pid in `butler/.pid`, command
  checked) is killed first.
- **Restart of Hive:** with the switch on (`~/.hive/butler.json`), the
  session comes back at launch the same way.
- **Off:** stops the session (Remote Control ends with it) and keeps the
  folder.
- **Requirements:** Claude Code logged in with a claude.ai subscription
  account; `python3` for the CLI (present with Xcode Command Line Tools,
  which git needs anyway).

## Client

`~/.hive/butler/hive` (`agents` / `tail` / `send` / `start`) wraps these
routes; `~/.hive/butler/CLAUDE.md` holds the butler's operating rules.
Both are written by Hive from `resources/butler/`. The hand-built
`~/FrontEndProjects/hive-butler/` predates this and is no longer needed.
