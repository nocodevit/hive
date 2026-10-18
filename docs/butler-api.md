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

Settings → Remote Control → "Allow remote control from my phone (Butler)",
off by default. Code: `src/main/butler.ts`, bundled files in
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
- **Folder trust:** the first run in a new folder asks whether to trust
  it. Hive detects the prompt, shows "Trust and continue" in Settings and
  answers only after that click.
- **Status:** connected once the `https://claude.ai/code…` URL is printed.
  A session that dies before connecting is shown as an error with its last
  output (e.g. not logged in) and is not retried in a loop. A connected
  session that exits is restarted with backoff (2 s, 10 s, 30 s, 2 min;
  the budget resets after 10 min up).
- **Restart of Hive:** with the switch on (`~/.hive/butler.json`), the
  session comes back at launch with `--continue`, falling back to a new one.
  A butler left behind by a crash (pid in `butler/.pid`, command checked)
  is killed first.
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
