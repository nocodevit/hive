# Feishu sign-in (Butler)

Butler acts on Feishu as the signed-in user (user_access_token). Code:
`src/main/feishuAuth.ts`, UI: App Settings → Feishu
(`components/FeishuConnection.tsx`).

## Split of duties
- **Jira Prime relay** (`nocodevit/jira-prime-feishu`, README "Hive 授权中转",
  `https://jira-prime-feishu.onrender.com`): holds the Feishu app secret and
  only exchanges codes and refreshes tokens. Stateless; never sees messages.
- **Hive main process**: PKCE + state, a one-shot loopback callback on
  127.0.0.1, the token exchange and refresh calls (main-process `fetch`, no
  `Origin`, `X-Hive-Client: 1`, 90 s timeout for a sleeping Render instance).
- **Day-to-day API calls** go straight to `open.feishu.cn` with
  `Authorization: Bearer u-…`.

## Tokens
- Encrypted with Electron `safeStorage` (key in the macOS Keychain) into
  `~/.hive/feishu-token.bin` (mode 600). e2e runs with an isolated
  `HIVE_DATA_DIR` may set `HIVE_FEISHU_PLAIN_STORE=1` for a plain file.
- Refreshed when < 5 min is left. A refresh token works once, so only one
  refresh runs at a time (concurrent callers share it).
- `invalid_grant` → tokens cleared, status "Sign-in expired". `rate_limited`,
  network and Feishu errors keep the session (the old access token is used
  while still valid).
- The refresh token lasts ~7 days: a Hive left closed longer needs a new
  sign-in.

## Relay override
`HIVE_FEISHU_RELAY` accepts only `http://127.0.0.1:<port>` (tests).

## Probe
`GET /feishu/probe` on the local butler API (`X-Hive-Token`) reports what the
token can do — scopes, chat counts and kinds, message kinds and times,
calendar count. Never message text or names (`src/main/feishuProbe.ts`).
