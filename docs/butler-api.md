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

## Client

`~/FrontEndProjects/hive-butler/hive` (`agents` / `tail` / `send` /
`start`) wraps these routes; `hive-butler/CLAUDE.md` holds the butler's
operating rules.
