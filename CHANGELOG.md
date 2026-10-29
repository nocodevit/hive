# Changelog

All notable changes per released version, newest first. From v1.7.127 on,
each entry is that version's GitHub release notes — the same text Hive's
update window shows, merged for every version you skip. Older entries were
back-filled from git history at v1.7.28.

---

## [2.40.2] — 2026-10-29

##### 🎃 Halloween skin
- The Send button is now a ghost in a hole: press it (or Enter) and a ghost pops out as your message goes, then ducks back a second later. Other skins keep the usual ↑.

---

## [2.40.1] — 2026-10-29

- 🧭 Dispatch never sends on its own: every pick is an **Assign card** — who, why, how sure Butler is (or "busy right now"), runners-up, the brief (click to edit) and a box for **your requirements**. **Assign** sends it with your requirements added; **Cancel** drops it (Undo for 5 s).

---

## [2.40.0] — 2026-10-29

- 🧭 **Butler gives work to the right agent.** Ask in the Butler chat ("帮我把 checkout 的 bug 修了"), Discuss a card or todo, or let the new hourly **Dispatch** routine look at open todos nobody has yet. Butler picks by project, role and what each agent did lately (the `dispatch` skill — tune it in Settings › Skills), then Hive applies one rule:
  - **sure and the agent is free** → the brief goes to it now (an agent that's off is resumed); the todo shows "→ Ada" and the story says why;
  - **not sure, or the agent is busy** → an **Assign** card in Approve with the reason, runners-up and the brief (edit it), sent only when you press Assign;
  - **no agent fits** → noted on the todo and you're told; it never creates agents.
- New `./hive assign`, `./hive nofit`, `./hive agents --detail`, `./hive run dispatch`.
- A routine added in a new version (like Dispatch) is installed on the next start when it's on.

---

## [2.39.7] — 2026-10-29

- **Switch model** from the chat's ⋮ menu: pick Opus 5.5 / Sonnet 5.5 / Haiku 5.5 / Fable 5.1 (or the agent's default) and confirm. A running chat switches in place — the conversation and its context carry on, no restart — and the pick sticks to that chat.
- Butler can close an agent's chat: `./hive stop --project … --agent …` (as Close Session does). It won't close one that is mid-task unless you agree (`--force`).

---

## [2.39.6] — 2026-10-29

- ＋ (attach) and 🎙 (voice) are two separate round buttons again; they only merge into one bar while you record.

---

## [2.39.5] — 2026-10-29

- Butler can read your calendar: `./hive calendar` (today), `./hive calendar tomorrow`, `./hive calendar 2026-10-30 --days 5` — through Hive's own Feishu / Mac Calendar access, as set up in Butler settings, instead of falling back to lark-cli. If a calendar can't be read, it says which and how to fix it (e.g. re-authorize Feishu).

---

## [2.39.4] — 2026-10-29

- 🎃 Lunges hit harder: at full size the ghost (or the gaping pumpkin) freezes for a beat (0.2 s) before it vanishes / snaps its jaws.
- README: the Halloween skin, a "What's new" section, and Butler as it is today (Approve, Todo, Today, Feishu answer-for-me).

---

## [2.39.3] — 2026-10-29

- 🎃 The pumpkin fiend joins the lunges: a carved jack-o'-lantern with a sinister grin (fangs of pumpkin flesh, candlelight through the gaps) rushes at you from far away, its jaw drops wide, then snaps shut with a shake while the screen flashes orange. Each lunge is now a ghost or the pumpkin, at random (every 2–5 min). Reduced motion: no lunges.

---

## [2.39.2] — 2026-10-28

- Feishu cards say **who** sent the message: the title leads with the person ("霍传俊 · …"), the group goes in the subtitle ("Feishu · 产品小队 · …"); notifications and the follow-up todo name them too. (New cards; existing ones are left as they are.)

---

## [2.39.1] — 2026-10-28

- 🕷 Spiders look real: no glow; a tight contact shadow under the body and a soft shadow cast down-right, as if lit from above.

---

## [2.39.0] — 2026-10-28

- ✨ Motion pass (micro-interactions skill), so every action shows it worked:
  - **Approve**: Send / Reply shows a spinner (the button keeps its width), then ✓, then the card leaves and the ones below slide up. New cards fade in.
  - **Dismiss / Drop** are instant, with an **Undo** toast for 5 s (a draining line; swipe it away).
  - **Todo**: ticking draws the ✓ and strikes the title through, then it moves to Completed (the count bumps). New rows fade in, rows glide to their new place when priority or due date changes, the due date rolls, View opens smoothly.
  - **Butler tabs**: the selected background slides from tab to tab; the Todo / Approve counts roll to their new number and bump.
  - **Menus** (Discuss ▾, priority, ⋮) grow from their button.
  - **Chat**: a message you send rises out of the input box.
  - Everything follows "Reduce motion" (fades only).

---

## [2.38.8] — 2026-10-28

- 🎃 The Halloween three: a new ghost — a sheet tented by its raised hands (the cloth falls straight from the fingertips, folds fan down, the hands flex), a mummy that shambles slowly along the bottom of the window every 1.5–4 min (one amber eye, arms out, loose bandages flapping), and Frankenstein's monster, whose head rises from the bottom edge every 2–5 min, neck bolts sparking, then sinks back. Reduced motion: neither the mummy nor the monster appears.

---

## [2.38.7] — 2026-10-28

- 🎙 Recording bar rebuilt to the micro-interactions spec (📘6 长按变录音条), for **tap and hold** alike: the pair stretches across the toolbar (stopping before Send), ＋ turns 45° into ✕, 🎙 rides to the right end, a red dot pulses beside a 0:03 timer, and a live waveform scrolls in from the right (canvas, every frame; a faint breathing line when you're quiet).
  - Hold ≥ 250 ms; release keeps the words; slide left past a third (or onto ✕) → "Release to cancel"; under 1 s is dropped ("Too short"); 60 s ends it, the last 10 s counting down in amber.
  - Tap = hands-free: ■ stops and keeps, ✕ / Esc drop. Auto send and its countdown stay usable inside the bar.
  - Only transform / opacity / clip-path animate; opening uses spring.smooth, closing spring.bouncy; errors shake the bar once and show in red; the live text fades in, and a finished sentence makes the input glow as it lands. Reduced motion: fades only.
- Butler and the resume prompt read only the last 2 MB of a chat log from disk (not the whole 100 MB+ file), and look up open chats in parallel.

---

## [2.38.6] — 2026-10-28

- 🕸 A spider's web hangs on for a minute or two, then slowly fades away (4 s) and the corner is free for the next spider.

---

## [2.38.5] — 2026-10-28

- Todo rows match the design: one line for the title and its tier (⚡ 要命 sits on the right and never wraps), the source moves to the second line, Discuss and View become small 💬▾ / › icons. The 要命 storm is brighter (red → amber glow, as in the mockup).
- 🎃 Ghosts fade almost out while they pass behind the Butler panel, so the text stays readable.

---

## [2.38.4] — 2026-10-28

- 🕷 Spider waves come half as often as before: every 20–120 s (2.38.3 had them every 5–30 s by mistake). Ghost lunges stay at every 2–5 minutes.

---

## [2.38.3] — 2026-10-28

- 🎃 Timing: a ghost lunges at you every 2–5 minutes (was 45–120 s); spider waves come twice as often, every 5–30 s.

---

## [2.38.2] — 2026-10-28

- 🎃 Scarier ghosts: hollow eyes with red embers, a wailing mouth, a torn tail. They wander the whole window (a new spot every 4–8 s, fading in and out), and every 45–120 s one lunges at you — it swells to fill the screen, eyes flare, the screen flickers dark — then it's gone. Reduced motion: they stay still.

---

## [2.38.1] — 2026-10-28

- Update window: notes for **every version you skipped**, newest first, one section each — jumping from 2.27 to 2.38 now shows all of it, not just the newest release's notes. Title says how many updates you're getting.
- CHANGELOG.md is complete again: every release since 1.7.127, the same text as the release pages.

---

## [2.38.0] — 2026-10-27

- 🎃 Halloween limited skin (Oct 24 – Nov 2): gold pumpkin + night violet, drifting ghosts, a ghost peeking over the chat input, bats, and waves of 1–3 spiders every 10–60 s that stop on the chat, look around and run off to spin a web in a corner. Puts itself on at the first launch in season; Settings › Theme palette switches back to any palette. After Nov 2 your previous palette comes back by itself.
- Reduced motion: no movement, webs only.

---

## [2.37.7] — 2026-10-27

- Todo priorities: ⚡ 要命 (storm row, always on top) / 🔥 冒烟 / 🧊 冻着 — set on add, from the row chip, in bulk, or ./hive todo pri

---

## [2.37.6] — 2026-10-27

- Butler: ./hive cards, ./hive card show / edit / close / reopen — rewrites a draft after you talk it over, closes a card with a reason, brings one back. Sending stays on the card.
- Discuss carries the card id; cards show "updated by Butler"; History shows "Closed by Butler" and why
- Recording bar motion: shrinks back with a fade, 🎙 rides the edge, press feedback, quiet breathing, reduced-motion aware

---

## [2.37.5] — 2026-10-26

- Hold 🎙 to talk: the ＋/🎙 pair becomes a recording bar with a live waveform; release to finish, release on ✕ (or Esc) to cancel
- ＋ attaches files (their paths go into the input)
- Todo: select several → Move to tomorrow (due date only)

---

## [2.37.4] — 2026-10-26

- Discuss ▾: Butler by default, or any agent in any project
- Todo: Discuss and View on each row; details open as a card

---

## [2.37.3] — 2026-10-25

- Chat: "Loading last session…" with a spinner while the past session is read, and after Resume until it is on screen
- Includes 2.37.2: no freeze at start (past sessions read on a worker thread, head / tail only)

---

## [2.37.2] — 2026-10-25

- Hive no longer freezes at start: past chat sessions are read on a worker thread, and only the start / end of each log (they reach 100MB+). 43 agents: from ~1 min of blocked UI to ~0.4s in the background

---

## [2.37.1] — 2026-10-25

- Approve cards redesigned: grouped Needs your call / Ready to send, filter by source, sender avatar + source + age, chat bubbles (their message, what Butler already sent, Butler's reply — click to edit), one action row, ⌘↵ to send

---

## [2.37.0] — 2026-10-23

- Butler › Todo: follow-ups with their whole story — what came in, what Butler and you did, when. Group by created / source / due, sort, search; Completed keeps the history
- Butler notes what it promised to follow up (Feishu "其余已转告", a card you discussed, Jira follow-ups it drafted); + on any Approve card; "记一下…" in Chat
- ? in Butler: what to say in Chat, 中 / EN (system language first), Try sends it
- Header switches show red / amber when on but not working

---

## [2.36.8] — 2026-10-22

- Approve: when Butler already sent the facts, the card shows what was sent and what is your call; Reply opens an empty box
- Includes 2.36.7: Discuss shows in the Butler chat as your message

---

## [2.36.7] — 2026-10-22

- Discuss (Approve cards, History, Today plan items) shows in the Butler chat as your message, even while the chat is starting

---

## [2.36.6] — 2026-10-22

Feishu answer-for-me, three cases only:
1. Can't answer / your decision → nothing is sent; you get a card
2. Can answer → answered, and you are told
3. Partly → the facts from Feishu / Jira / this chat go out with "其余已转告 Megan，稍后回复"; the rest is a card

---

## [2.36.5] — 2026-10-22

- Feishu: no decline line either — a guarded topic is silence + a card for you
- An approved reply never carries two assistant tags

---

## [2.36.4] — 2026-10-22

- Feishu: while a message waits for you, nothing is sent to them — no "我需要和…确认" lines. Private topics still get the polite decline; an agreed proposal gets 👍
- Today: plan items can go to the Butler chat (💬)

---

## [2.36.3] — 2026-10-22

- Today: every plan item has 💬 to take it to the Butler chat
- Includes 2.36.2: the Butler chat no longer loses its history at start

---

## [2.36.2] — 2026-10-22

- Fix: the Butler chat lost its history at every Hive start. The phone Butler now runs in its own folder and can no longer rewrite it
- Feishu: small talk held for you is answered in Butler's own words and the sender's language

---

## [2.36.1] — 2026-10-22

- Feishu: when every fact is checked, the analysis is sent right away; only the judgment (e.g. escalate or not) comes to you
- Skill updates: Overwrite / Keep mine / Merge, or save the new version beside yours
- Every Approve card has 💬 Discuss: take it to the Butler chat instead of replying

---

## [2.36.0] — 2026-10-22

- Butler skills have versions and a changelog. If you rewrote a skill and Hive ships a new version, you are asked once: Overwrite with new, Keep mine, or Save mine as a copy — with what changed
- Handle Jira: engineering follow-up (PR / task / version) only for product issues in the active sprint
- Feishu cards show the sender's whole message
- Skills are refreshed at every start

---

## [2.35.9] — 2026-10-22

- Jira cards in Approve and History link to their ticket (P4-6926 ↗)

---

## [2.35.8] — 2026-10-22

- Feishu: Butler never answers another AI assistant's message (two assistants could loop forever)
- One holding reply per person per chat; later messages join the card already waiting for you
- At most 3 Butler messages per chat per hour by default

---

## [2.35.7] — 2026-10-21

- Jira: connect through Stargate or directly (Jira URL + token) — Settings › Jira › Connection, Auto uses Stargate first
- Approving a Jira comment or reassign card now carries it out
- Butler can read Jira without Stargate (./hive jira)

---

## [2.35.6] — 2026-10-21

- Run any routine now: Run in Today › Routines, or tell Butler "handle my Jira" (./hive run jira); a failed routine shows why
- Evening report as Needs you / Open / Done
- Chat: a long word wraps when the panel is narrow

---

## [2.35.5] — 2026-10-21

- Today: ignore a plan item (✕). It leaves Today; an email task's email is marked read. Tick only what is really done.

---

## [2.35.4] — 2026-10-21

- Butler chat no longer loses its history: the phone Butler gets its own session, and the desk chat resumes its own
- Feishu calendar cards are read (title + time), so Butler can check the calendar
- Default reply prefix is half-width: [Assistant · Name 的 AI 代理]
- Resume shows Resuming… and can't be pressed twice; buttons sink when pressed

---

## [2.35.3] — 2026-10-21

- Today redesigned: day arrows (past days and their summary), status chips, next meeting, plan with progress, folded rows
- Feishu: scans right after Hive opens; Scan now button
- Feishu: a reply that hands a question to you is held, so you get a card
- Header switches: 📱 💬 🎙; Sessions sorted by newest activity

---

## [2.35.2] — 2026-10-21

- Window title is "Hive" (the Dock menu showed a stale v0.4.0-beta)
- Removed a disabled Pause button left from an old plan

---

## [2.35.1] — 2026-10-21

- 📱 Mobile Butler, 💬 Feishu answer-for-me and 🎙 Hola Butler are switches in the title bar
- Sessions: newest chat activity first within each status, with time since

---

## [2.35.0] — 2026-10-21

- Title bar across the window again (location + Butler), like the mockup
- Today: every routine shows ran / failed / next / missed / off
- Approve: this week's history, each can be taken to the Butler chat
- Voice: what the mic hears shows in full in the input box
- Feishu: Re-authorize button
- Agent names and view tabs are normal weight; only the selected one is bold

---

## [2.34.1] — 2026-10-21

#### Settings › Jira (new)
- Your company's Jira specifics — projects and their roles, final statuses, who owns what, the dev lead, thresholds, what labels mean — are now **settings**, not a skill.
- **Set up from Jira**: Butler looks at your Jira with read-only access and drafts them; you check each line and save.
- The jira-knowledge skill is now general knowledge that ships with Hive.

Everything from 2.34.0 (Feishu direct messages, meetings, People list, daily Jira, morning/evening, notifications, settings navigation, mailbox consent, quick switches) is included.

#### Install
- Apple Silicon: `Hive-2.34.1-arm64.dmg`. Signed, not notarized — first launch: right-click → Open.
- From 2.27+: Check for Updates → Install & Restart.

---

## [2.34.0] — 2026-10-21

#### Feishu answer-for-me
- Now sees **direct messages** (before, only groups were read).
- Small talk is answered; private / personal / sensitive / confidential questions get a polite "not mine to share".
- Meetings: proposes free times from your calendar and, when they say ok, **creates the Feishu meeting** with a video link and a 15-minute reminder.
- "ok" with nothing proposed gets a 👍. Several lines from one person get one reply.
- **People** list: tell Butler who is your manager, your team, other teams.
- A ticket whose status is wrong becomes a "Jira → status" card for you to apply.

#### Jira (daily)
- Closes requests whose product issue shipped, drafts questions for stuck requests, asks the dev lead for a missing engineering task, suggests handing tickets to their owner, and lists stuck / old tickets in Today — set up per person, nothing changes without you except the clear-cut close.

#### Your day
- Morning: today's meetings + a plan from what waits for you and Jira.
- Evening: what agents **and Butler** did, plus the @mentions of you (the separate @mention routine is gone).

#### Notifications (new)
- Mac notifications (on by default), quiet hours, per-event switches; when you're away, push to your phone via Telegram (guided setup). Phone Butler opens with what's waiting.

#### Also
- App Settings has a left navigation.
- Adding a mailbox asks for consent first (Butler reads and drafts; sends only after your OK).
- 📱 / 💬 quick switches next to the Butler button.

#### Install
- Apple Silicon: `Hive-2.34.0-arm64.dmg`. Signed, not notarized — first launch: right-click → Open.
- From 2.27+: Check for Updates → Install & Restart.

---

## [2.33.7] — 2026-10-21

#### Feishu answer-for-me (代管)

- Knows who is asking (manager, your report, colleague, other department) and where (direct or group), and sorts the question: chit-chat, product status, product knowledge, help for your team, new request, meeting, needs more info.
- Checks what people claim before agreeing ("X already supports Y") — against Jira, docs, the knowledge base and code you can access.
- Anything it is unsure about, corrections, and messages from your manager go to you first. Six guardrails always come to you: prices, approvals, private chats, personal / sensitive / confidential info — each with an example; add your own topics with keywords.
- Meeting requests use your free / busy (never meeting titles). Several lines from one person get one answer. "ok" agrees to what Butler proposed, otherwise it just gets a 👍.
- Keeps a record of every case and what you did with it, for later learning.

#### Email

- A question for you never sits behind Send any more: such emails show "Needs you" with Discuss and a short answer box; the reply box is exactly the email that goes out.

#### Butler

- Uses the tools your own Claude setup has (e.g. Jira, knowledge base) — one allow-list for everything Butler does.
- Phone Butler keeps working when Hive's window is closed (since 2.33.6); a second Hive launch now brings the running one forward.

#### Install

- Apple Silicon: `Hive-2.33.7-arm64.dmg`. Signed, not notarized — first launch: right-click → Open.
- From 2.27+: Check for Updates → Install & Restart.

---

## [2.33.6] — 2026-10-21

#### Fixes

- **Butler said "Hive is not running" while Hive was open.** Closing Hive's window (Hive stays in the Dock on macOS) cut the phone Butler off. Butler now keeps reaching Hive until you quit it, and starting an agent from the phone reopens the window if needed.
- Opening Hive a second time no longer cuts Butler off from the first one.
- If Butler still can't reach Hive, it now says whether Hive is open or closed, and Hive keeps a log in `~/.hive/port-lock.log` to send us.
- The version shown in the title bar now always matches Check for Updates.

#### Since 2.33.1

- Name your assistant (reply prefix and self-introduction); Butler setup shown again after upgrading, with your old settings filled in; resumed chats show their status dots.
- About you: full field set, Tab fills the example, new **Extra** field. Setup wizard fits the screen.
- Email password guide in English; every Daily routine item explained; 24-hour time boxes; "Skill ›" links open each routine's skill.

#### Install

- Apple Silicon: `Hive-2.33.6-arm64.dmg`. Signed, not notarized — first launch: right-click → Open.
- From 2.27+: Check for Updates → Install & Restart.

---

## [2.33.1] — 2026-10-20

#### Butler — your assistant inside Hive

Top-right **Butler** button → a panel with **Chat**, **Sessions**, **Approve** and **Today**. Pin it to the top of the project list.

- **Setup wizard**: theme, voice, about you, phone, email, Feishu, calendar, daily routine. Skip anything; resume later from the panel.
- **About me + Skills**: one persona for everything Butler writes for you; each job (morning plan, evening report, inbox, email replies, Feishu answers, Jira) follows an editable skill. Change a skill by just describing the change.
- **Email**: several accounts (腾讯企业邮箱, QQ, 163, Gmail, other). Butler sorts new mail and drafts replies — **nothing is sent until you press Send** in Approve. The card shows the real recipient.
- **Daily routine** (macOS): morning plan, inbox sorting, Feishu digest, evening report — runs even when Hive is closed.
- **Feishu answer-for-me (代管)**: sign in with Feishu once; Butler replies as you, every message marked with your prefix. Dates, prices, promises, approvals and customers come to you first. Recall within 24 h.
- **Calendar**: Feishu calendar + Mac Calendar feed the morning plan.
- **“Hola Butler”**: on-device wake word; say “Hola Butler, 告诉 Missy …” and confirm the 3-second forward.
- **Ready-to-send text** (emails, messages) shows as a card with one Copy.
- **Phone control** (since 2.28): Claude app → Code → Hive Butler.

#### Install

- Apple Silicon: `Hive-2.33.1-arm64.dmg`. Signed, not notarized — first launch: right-click → Open.
- From 2.27+: Check for Updates → Install & Restart.

---

## [2.28.3] — 2026-10-19

#### Control Hive from your phone (Butler)

New in Settings → **Remote Control**: *Allow remote control from my phone (Butler)*, off by default.

Turn it on and Hive keeps a Claude Code session called **Hive Butler** running on this Mac with Remote Control. On your phone, open the Claude app → **Code** and tap "Hive Butler". From there you can ask in plain words who is running, what an agent last said, or have a message typed into the chat of the agent you name.

- The first time, Claude Code asks whether it may run in Hive's Butler folder. Hive shows **Trust and continue** in Settings and waits for your click. Turning the switch off withdraws it; turning it on again asks again. Hive also follows Claude Code's own trust setting for that folder.
- The Butler only reads agent status and chats and sends messages to the agent you name. It never starts an agent's chat on its own, never guesses between agents with the same name (it asks you), and cannot edit files.
- With the switch on, the same session comes back after Hive restarts, so your phone keeps one "Hive Butler" and its history.
- Needs Claude Code signed in with a claude.ai subscription account, the same account as on your phone.

#### /goal replies as a card

The confirmation after `/goal …` now renders as a card (numbered rules, folded when long) instead of a wall of text, and a typed `/goal` shows as a compact pill.

#### Install

- Apple Silicon only: `Hive-2.28.3-arm64.dmg`. Signed, not notarized — if macOS blocks the first launch, right-click the app → Open.
- From v2.27.0 or later: **Check for Updates → Install & Restart** does it for you.

---

## [2.27.0] — 2026-10-13

#### Updates install themselves

"Download & Install" used to open the disk image and leave you to drag Hive into Applications — which fails while Hive is running.

From this version on: Hive downloads the update, checks it (valid signature, newer version, signed by the same developer), and the button becomes **Install & Restart**. One click: Hive closes, replaces itself and reopens. If it can't do that on your machine, it says why, opens the installer as before, and offers **Quit Hive** so the manual drag works.

> **This one time you still install by hand**: the installing is done by the version you already have. Quit Hive, then drag the new one into Applications. Every update after this is automatic.

#### Resume where you left off

When you open Hive, it now lists the agents whose chats were still open when it last closed (or crashed): project, agent, the last thing you asked it, its context %, and whether resuming will compact first. Everything is ticked by default, with **Select all**; nothing starts until you press **Resume**. Chats you closed yourself are not listed. "Not now" drops the list.

Together with the above: updating stops your running chats, and the relaunched Hive offers to bring them back.

#### Fixes

- Projects whose folder path contains `_`, `.` or a space: Hive looked for their saved Claude sessions in the wrong place, so Resume started a new session and showed no context %. Fixed.

#### Install

- Apple Silicon only: `Hive-2.27.0-arm64.dmg`. Signed, not notarized — if macOS blocks the first launch, right-click the app → Open.

---

## [2.25.2] — 2026-10-13

#### The bug

A `/goal` with nothing left to do could not be stopped — or even talked to — from Hive.

`/goal` keeps Claude going with a Stop hook: every time Claude tries to end its turn, the hook answers "not done" and Claude goes again, all inside **one** turn. Anything you sent meanwhile was only queued behind that loop, `/goal clear` included. So a finished-but-unmet goal kept spinning, burning tokens, and your messages never arrived. Because the goal lives in the session, it also came back after `/compact` and after restarting the chat.

#### The fix

- **Your message gets through.** `/goal clear` now takes effect immediately during any running turn. Once a goal is just spinning (sent back twice in a row without doing anything), any message you send interrupts the loop and is handled right away. While the goal is still doing real work, an ordinary message waits as before, so a running command is not cut off half-way.
- **A way out you can see.** When a loop is stuck, the chat shows a notice explaining what is happening, with a **Clear goal** button — also for goals Hive is not tracking as a handoff (set by hand, or left over from before a restart).
- **No more wall of repeats.** Each "not done" round used to appear as another copy of the goal text, styled like your own message. They are now one collapsed line: `↻ Goal not met yet … (×N)`.
- **Command replies are shown.** Claude Code's own answers to slash commands — "Goal set", "Goal cleared", "No goal set" — were never displayed in the live chat. They are now.

#### Also since v2.25.0

- The auto-send pill is labelled **Auto send**.

#### Install

- Apple Silicon only: `Hive-2.25.2-arm64.dmg`. Signed, not notarized — if macOS blocks the first launch, right-click the app → Open.
- Existing installs will offer this update on their own (Hive → Check for Updates…).

---

## [2.25.0] — 2026-10-12

First GitHub release since v2.15.4. Highlights of what changed (v2.20.5 → v2.25.0); earlier versions are in the commit history.

#### New look — one canvas, floating cards
- The whole window uses one background; the agent list, the main panel and the file panel are rounded cards with even gutters and no divider lines. Every column has the same header.
- Chat follows the app theme (light = white card). Replies are set in the UI font, monospace only for code, commands and numbers. Your messages are right-aligned bubbles.
- The composer is one rounded box: text on top, controls below (voice, auto-send, Streaming, context, Compact, ⋮, Send/Stop), with a neon outline in the palette color.
- All three palettes (Neon Purple, Tech Blue, Future Pink) now recolor the chat too, and the Prime style works with Future Pink.

#### Voice input
- **Mixed 中文 / English in one sentence**: with an OpenAI API key (App Settings → Voice Input), each spoken sentence is transcribed by OpenAI (`gpt-4o-mini-transcribe` by default, `gpt-transcribe` selectable). Without a key, or if the call fails, it falls back to the macOS recognizer and tells you.
- **Auto-send** (off by default): when you stop talking, a short countdown sends what you dictated. Speaking again, typing or clicking the countdown cancels. The mic keeps listening afterwards.
- With a key, your speech is uploaded to OpenAI for transcription; recordings are deleted from disk right after.

#### Butler API — drive Hive from another Claude session
Local-only HTTP routes (127.0.0.1, token-protected) to list agents, read a chat's last messages, type into a specific agent's chat and start a chat. Meant for a `claude remote-control` / Dispatch session on the same Mac, so you can ask "who is done?" or hand an agent an instruction from your phone. See `docs/butler-api.md`.

#### Fixes
- **/compact silently did nothing** when Claude Code queued a "background tasks have no completion record" notice ahead of it: Hive stopped at the notice's empty result and never ran the compact. It now waits for the real compact result.
- Voice helper is always shut down when Hive quits; a helper that dies resets the mic button instead of leaving it on "listening".

#### Install
- Apple Silicon only: `Hive-2.25.0-arm64.dmg`.
- The app is signed but **not notarized**. If macOS blocks the first launch: right-click the app → Open, or allow it in System Settings → Privacy & Security.
- macOS may ask again for microphone / speech-recognition permission.

---

## [2.15.4] — 2026-08-26

#### The bug

You: *context 都 81% 了, 你在 handsoff 里没有 compact 啊！你什么时候 compact？*

Auto-compact was NEVER firing on claude-opus-5. Ever. /goal loops just ran to 81%+ ctx while the supervisor sat silent.

#### Root cause

Verified in \`~/.hive/chat-logs\`: recent \`claude-opus-5\` \`system:init\` events **dropped the \`contextSize\` field entirely**. Now emit only:
\`\`\`json
{"type":"system","subtype":"init","session_id":"...","model":"claude-opus-5"}
\`\`\`

Handoff supervisor in [handoff.ts](src/main/handoff.ts) read \`event.contextSize\`, got \`undefined\`, kept \`h.contextSizeTokens = 0\` (initial value). Then the auto-compact gate:
\`\`\`ts
if (h && h.contextSizeTokens > 0 && h.lastInputTokens > 0) {
  if (shouldTriggerAutoCompact(pct, ...)) tryAutoCompact(runId)
}
\`\`\`
**\`contextSizeTokens > 0\` always failed** → \`tryAutoCompact\` was **never called even once**.

The renderer's ctx% bar had the same bug months ago but was fixed inline: *if contextSize absent, infer from model name — haiku=200K, everything else=1M*. That inference was never mirrored into the main-process supervisor. Classic main/renderer drift.

#### Fix

New shared helper \`resolveContextSizeTokens(explicit, model)\` in \`src/shared/context-size.ts\`:
1. Prefer the explicit \`contextSize\` string when present
2. Otherwise infer from model: \`haiku → 200K\`, everything else \`→ 1M\`
3. Return 0 only when both are absent (supervisor bails cleanly)

Handoff supervisor now calls this helper. **Single source of truth** so main and renderer can't drift on this rule again.

#### Test

New \`context-size-resolve.test.ts\` with 9 pins:
- Explicit \`'1M'\`/\`'200K'\` honored
- \`claude-opus-5\` with no \`contextSize\` → 1M (the real-world fix)
- \`claude-sonnet-5\`, \`claude-fable-5\`, \`claude-opus-4-7\` → 1M
- \`claude-haiku-*\` → 200K (case-insensitive)
- Both absent → 0 (fail-safe)
- Malformed explicit + valid model → falls back to model
- **End-to-end user scenario**: \`810_000 tokens / 1_000_000 = 0.81 > 0.70\` threshold → \`shouldTriggerAutoCompact\` returns true

**1222/1222** unit tests + TypeScript clean.

#### Install

Download DMG (\`arm64\` for Apple Silicon, plain for Intel), or click **Check for Updates…** in the app menu.

Unsigned; on first launch, right-click → Open.

---

## [2.15.3] — 2026-08-26

#### The bug

You: *为什么 compact 总是不成功*.

Dug into \`~/.hive/compact-log.jsonl\` — **30 entries** with \`ok=true, durationMs≈3000, resultUsd=$0\`. Latest was today at 13:47 on \`cube-new-wendy\`.

#### Root cause

Claude's \`/compact\` slash command in \`--print --resume\` mode **occasionally returns \`{subtype:'success', is_error:false}\` in ~3s at cost=\$0** — proof the LLM summarization API was never called. Empirically happens when the session is already-compacted, too small, or when \`--resume\` loads an already-compact view.

Hive interpreted \`subtype==='success' && !is_error\` as \`ok=true\`, broadcast \`✅ /compact done in 3s · session resumed\`, and the renderer's ctx% reset fired. But ctx actually didn't change — nothing was compacted — so on the next \`assistant.usage\` event ctx% snapped back to the pre-compact value. You saw *"✅ says success, then ctx% doesn't drop"* → concluded compact is broken.

#### Fix

New pure predicate \`isCompactNoop(resultEvent, durationMs)\` returns true iff \`cost === 0 && duration < 10s\`. \`runCompactViaPrint\`:
- Detects no-op after receiving the "success" result
- Flips \`finalOk=false\`, sets \`error='no-op (LLM never called — session may be already-compacted or too small)'\`
- Adds \`noop: true\` flag to return + log
- Captures \`result.result\` text (first 500 chars) in \`~/.hive/compact-log.jsonl\` for future debug

Callers (\`compactSession\` + \`forceCompact\` + \`Compact+Fork\`) already handle \`{ok:false}\` — they broadcast a truthful:

\`❌ /compact no-op (LLM never called — session may be already-compacted or too small) (3.1s) — context UNCHANGED, session resumed\`

Renderer's text-branch already matches \`/compact\` + \`context UNCHANGED\` (the failure-path settler), so \`compactStartedAt\`/\`compactStuck\` clear cleanly AND \`setLatestInputTokens(0)\` does NOT fire (only triggers on \`/compact done\` or \`Compacted\` text). Ctx% stays at the real value — no misleading 0% flash.

#### Tests

New \`compact-noop.test.ts\` with 7 pins on the pure predicate:
- Fires on real-world pattern (usd=0, dur=3s)
- Fires on any zero-cost <10s result
- Does NOT fire on real compact (cost > 0)
- Does NOT fire on fast-but-costed result (edge)
- Fail-safe on missing/malformed/null cost fields
- Fail-safe on null/undefined result event

**1213/1213** unit tests + TypeScript clean.

#### Install

Download DMG (\`arm64\` for Apple Silicon, plain for Intel), or click **Check for Updates…** in the app menu.

Unsigned; on first launch, right-click → Open.

---

## [2.15.2] — 2026-08-26

#### The bug

During /compact, typing a message shows the *Draft saved — will send after compact completes* chip. Compact finishes. Chip disappears. **Message never actually sent — silently lost.**

#### Bug forensics (why it broke)

`git blame` on the auto-flush useEffect points to \`c962c380\` (v1.7.120, 2026-05-23) — that's when the pendingDraft mechanism was born, and \`deps=[compactInProgress]\` has been the same since.

**Why it worked before v2.13.0**: not because deps were right — because there was only ONE path that cleared \`compactStartedAt\`: HIVE's own stderr line \`✅ /compact done in Xs · session resumed\`. HIVE emits this in \`compactSession()\` **after** \`startChat()\` has returned, so by the time the useEffect fires the new --print child is fully registered and its stdin pipe is ready. \`chat.send\` hits an alive process. Works.

**Why v2.13.0 broke it**: I added a SECOND clear path — the \`isCompactSummaryEvent\` user-event branch. That event comes from the **new** claude child's own stream, and can arrive in a narrow window where the child has spawned but its stdin pipe isn't ready or \`sessions.get(id)\` still returns stale state. \`sendUserMessage\` returns \`{ok:false, error:'no_session'|'not_in_print_mode'}\`.

**The kill shot**: the useEffect body was
\`\`\`ts
window.api.chat.send(id, draft).finally(() => setSending(false))
\`\`\`
— it never checked \`res.ok\`. When send failed in that window, \`pendingDraft\` had already been cleared unconditionally. Message silently LOST.

#### Fix (two layers)

1. **Deps** widened to \`[compactInProgress, exited, pendingDraft]\` so the effect re-runs on any of the three, not just \`compactInProgress\` — needed so that step 2's restore actually triggers a retry.
2. **Result-check + restore**: on \`{ok:false}\` or a promise rejection, restore \`pendingDraft\`. The restore triggers a re-render, which re-runs the effect (because \`pendingDraft\` is in deps), which retries the send. Once the new child is truly ready, retry succeeds and the flush completes cleanly.

Also covers IPC transport errors (promise rejection path).

#### Tests

New regression tests in \`compact-pending-draft-flush.test.tsx\`:
- \`chatSend\` returns \`{ok:false}\` first call, \`{ok:true}\` second — asserts \`chatSend\` called twice, draft eventually delivered
- \`chatSend\` rejects (transport error) first call, resolves second — same retry behavior
- Plus the earlier tests: no-fire during compact, no-fire without pendingDraft, no double-fire on spurious re-render, correct fire when new session comes alive

**1206/1206** unit tests green.

#### Install

Download DMG (\`arm64\` for Apple Silicon, plain for Intel), or click **Check for Updates…** in the app menu.

Unsigned; on first launch, right-click → Open.

---

## [2.15.1] — 2026-08-25

#### Two fixes

##### 1. Handoff turn counter stuck at 0 during /goal loops

**Bug**: Banner showed \`Handoff running · 1h 11m · turn 0 · \$0.00\` even after Missy had pushed 2 MRs.

**Root cause**: The supervisor only incremented \`turnCount\` on \`type: 'result'\` events. But Claude's \`/goal\` autonomous loop emits **ONE** \`result\` at the very end (an hour later) and **many** \`assistant\` events during the loop. So hour-long handoffs with 20 LLM turns showed \`turn 0\` until the whole thing settled.

**Fix**: Count \`assistant\` events as turn boundaries (each = one LLM round-trip = user's mental model of "turn"). \`result\` still carries the cost, just no longer the turn count. Also fixed: banner now updates on cost-only advance so the final \`\$\` value refreshes when the \`/goal\` settles.

##### 2. Pink base surfaces back to dark grey

You called v2.15.0 out: *粉应该搭配深灰 (dark theme)* and *agent 的背景和 chat 的背景不协调统一*. The pink-tinted bases went muddy on top of pink and clashed with the Crush-locked chat pane.

**Fix**: Base surfaces are now neutral dark grey (Pepper family). Only accents / borders / text-muted / sidebar-active carry the pink hue — the classic cyberpunk pattern where pink pops **harder** against grey than against pink-tinted grey.

| Token | v2.15.0 | v2.15.1 |
|---|---|---|
| \`--bg-primary\` | \`#120515\` (dark pink) | \`#1a181c\` (neutral grey) |
| \`--bg-hover\` | \`#3d1745\` | \`#332f3a\` |
| \`--border-default\` | \`#4a1858\` | \`#3a2f38\` |
| \`--text-muted\` | \`#e59bc6\` (vivid pink) | \`#b8a3ac\` (grey-pink) |
| \`--bg-terminal\` (chat pane) | \`#2a0a1e\` | \`#201F26\` (Crush Pepper, restored) |

Accents unchanged: **\`--accent #ff2eaa\`**, **\`--accent-muted #ff007f\`** — still hot neon fuchsia.

Agent column and chat pane now match perfectly.

#### Testing

- \`handoff-supervisor.test.ts\` rewritten: 20 assistants + 1 final result → turn=20 (was turn=1). Result-only events no longer count toward turn.
- \`palette-bg-overrides.test.ts\` inverted back: dark palettes MUST NOT override \`--bg-terminal\`.
- \`pink-neon-palette.spec.ts\` asserts base surfaces have chroma < 20 (proves neutral grey), accents have R > 200 + R-G ≥ 100 (proves neon punch), chat bg exactly Pepper (32, 31, 38).

**1200/1200** unit + **2/2** pink e2e green.

#### Install

Download DMG (\`arm64\` for Apple Silicon, plain for Intel), or click **Check for Updates…** in the app menu — you'll get the shiny new update window from v2.14.0 too.

Unsigned; on first launch, right-click → Open.

---

## [2.15.0] — 2026-08-25

#### Two color changes

##### 1. Future Pink reworked to neon fuchsia

Old palette read as warm-plum / brown because every dark bg had `R > G > B` (warm) channel ratios and `--text-muted` was `#b48aa0` — a desaturated mauve that reads as taupe on OLED. You called it out: *太棕了, 要那种霓光粉*.

Every dark-mode hex reworked so `R > B > G` (cool-pink lean, never warm-plum):

| Token | Before | After |
|---|---|---|
| `--accent` | `#f472b6` | `#ff2eaa` (hot neon fuchsia) |
| `--accent-muted` | `#db2777` | `#ff007f` (Barbie neon) |
| `--text-muted` | `#b48aa0` (mauve/taupe) | `#e59bc6` (bright bubblegum) |
| `--border-default` | `#422538` | `#4a1858` (pinker, higher chroma) |
| `--bg-hover` | `#3d1f31` | `#3d1745` (chroma bumped) |
| swatch / tagline | `#f472b6` · Hot magenta | `#ff2eaa` · Neon fuchsia · vaporwave forward |

Light mode retuned too: `--text-muted` `#83506a` → `#b06888` (pinker), accent punched to `#e6008a`.

##### 2. Chat surface follows palette

Previously `--bg-terminal` (the chat pane background) was pinned to Crush Pepper `#201F26` across every palette, so switching to Future Pink or Tech Blue left the chat pane looking like a warm-grey island against the themed shell. With explicit approval to deviate from the Crush lock:

| Palette | `--bg-terminal` |
|---|---|
| Neon Purple (default) | `#201F26` (Pepper — unchanged) |
| Tech Blue | `#0b1424` (deep blue-black) |
| Future Pink | `#2a0a1e` (deep neon-pink) |

Other Crush colors used inside chat (Sriracha user bubbles, Julep buttons, Squid/Ash text, Dolly/Mochi tabs) STAY at their locked hexes. Only the surface background is themed.

#### Testing

- `palette-bg-overrides.test.ts` inverted: dark palettes MUST override `--bg-terminal`, light must NOT.
- New `e2e/pink-neon-palette.spec.ts`: real Electron launch, reads computed CSS vars off `:root`, asserts:
  - Every bg / border / text-muted / accent token has `R > G` AND `B >= G` (cool-pink lean, no warm-brown quadrant)
  - Accents have `R > 200` AND `R - G >= 100` (neon-punch invariant)
  - `--bg-terminal` has shifted away from Pepper `#201F26`
  - Screenshots saved for eyeball verification.

**1199/1199** unit + **3/3** pink e2e green.

#### Install

Download DMG (`arm64` for Apple Silicon, plain for Intel), or click **Check for Updates…** in the app menu.

Unsigned; on first launch, right-click → Open to bypass Gatekeeper.

---

## [2.14.0] — 2026-08-25

#### The bug

Check-for-Updates was a native macOS NSAlert. Four separate bugs, all rooted in the wrong primitive:

1. Release notes rendered as **raw markdown** (`## Fix`, `**bold**` shown as literal chars).
2. Long notes were sliced to 800 characters with `(truncated)` at the end — no way to scroll.
3. Clicking **View release notes** *closed* the dialog before the browser opened.
4. Choosing **Download & Reveal** gave **zero feedback** — silence for 30+ seconds until Finder auto-mounted the DMG.

#### The fix

Replaced `dialog.showMessageBox` with a self-owned `BrowserWindow` for the "new version available" flow. Native dialog is only kept for the tiny *up to date* / *check failed* states where markdown and scroll don't matter.

##### New window
- **Header** — `v2.13.0 → v2.14.0` version diff + release title
- **Body** — full markdown release notes rendered via `marked`, dark-themed, scrollable
- **Footer buttons**
  - `View on GitHub ↗` — opens browser, window stays open
  - `Later` — snoozes this tag
  - `Download & Install` — inline progress bar (per-chunk bytes + %), auto-opens DMG when done

Ships with `marked` (~40KB) as a runtime dependency.

##### Tests
22 new unit tests on the pure HTML renderer covering markdown conversion, no-truncation, scroll wiring, XSS escaping, button presence, and the "don't close on link click" invariant. **1197 / 1197** unit tests green.

#### Install

Download the DMG (`arm64` for Apple Silicon, plain for Intel), or click **Check for Updates…** in the app menu — this is the last release you'll ever see the old dialog for.

Unsigned; on first launch, right-click → Open to bypass Gatekeeper.

---

## [2.13.0] — 2026-08-25

#### Fix

**ctx% now resets the instant `/compact` finishes** — no longer waits for the next assistant turn.

##### The bug
After `/compact` finished, the top status bar kept showing the pre-compact context % (e.g. 68%) until you typed your first message and Claude echoed back an `assistant.usage` event. The compact was done but the UI lied.

##### Root cause
v2.5.3 tried to reset by string-matching `/compact done` in the stream text. Current Claude CLI emits `<local-command-stdout>Compacted </local-command-stdout>` instead — the string match never fired.

##### Fix
Reset now piggybacks on the `compact_boundary` event (`isCompactSummary: true`), which is the earliest 100%-reliable "compact finished" signal from Claude's stream. When it lands:
- `ctx%` drops to 0 immediately
- `compactStartedAt` clears
- Ctx-nag banner dismissal resets so the next 80% crossing warns again

Next `assistant.usage` event refreshes ctx% to the real post-compact value.

Belt-and-suspenders: text-match branch also updated to recognize `Compacted ` alongside historical `/compact done`.

#### Install
Download the DMG for your Mac (`arm64` for Apple Silicon, plain for Intel), or click **Check for Updates…** in the app menu if you're on v2.10.0+.

Unsigned; on first launch, right-click → Open to bypass Gatekeeper.

---

## [2.12.0] — 2026-08-24

Second Prime pass. Every remaining surface now reads as Prime when you toggle it in App Settings → Visual style.

#### What's new
- Buttons / inputs / tabs / StatusPill / modals all get Prime CSS overlays (mono font, accent glow, sharp corners)
- Focus ring already accent-colored (v2.10.0)
- KPI headline digits pick up accent text-shadow glow
- Sidebar selected row picks up accent inner glow
- Context menus get accent border + hover
- New e2e/prime-4-combos.spec.ts captures all 4 (theme × palette) combos into test-results/

#### Try it
Menu → Hive → Check for Updates (v2.10.0 → v2.12.0 = auto-mount DMG improvement + full Prime).
Then: App Settings → **Visual style** → toggle **Prime**. Palette picker below narrows to Neon Purple + Tech Blue (Prime doesn't support Pink — warm hue fights the HUD vocabulary).

---

## [2.10.0] — 2026-08-24

#### Accent visual system + updater auto-mount

##### Visual polish (Accent)
- **Elevation scale** — 3 shadow tiers wired everywhere (cards / dropdowns / modals). Theme-aware.
- **Motion tokens** — 120/220/380ms + smooth curve. \`card-lift\` utility gives interactive cards a 1px translate + shadow bump on hover.
- **Focus ring** — accent-colored global \`:focus-visible\` replaces macOS default blue.
- **StatusPill component** — one shared implementation replaces the ad-hoc status spans (working / waiting / idle / handoff / danger).
- Modals promoted from generic \`shadow-2xl\` to semantic \`shadow-e3\`.

##### Updater (this is what you're using right now!)
Menu → Hive → **Check for Updates…** now:
1. Downloads the DMG to \`~/Downloads\` 
2. **Auto-mounts** the DMG (Finder opens the drag-Hive-to-Applications overlay directly — no double-click step)
3. Follow-up dialog explains: drag Hive → Applications → quit → relaunch

##### Overview improvements
- Close X button + Esc keybinding (webkit-app-region: no-drag so it responds on 1st click)
- Closed section: flat sorted wrap chips (not per-project rows), sorted by project A-Z + agent A-Z
- Loaded session panes counter uses \`activeTerminals\` (immediate) — no lag after clicking Resume
- Renamed labels: "Open sessions" → "Session panes", "Idle" → "Ready", "Sleeping" → "Closed"

##### Other
- Chat font size now global in App Settings (was per-project)
- Chat input auto-grows to 5 lines then scrolls
- Overview grouped by project A-Z, agents A-Z within
- Random pixel avatar for new agents
- Waiting status color: amber → sky blue
- Prime style scaffolding shipped (App Settings → Visual style · Accent | Prime; Prime is a HUD/CRT overlay, currently minimal until v2.11)

##### Installation
Drag \`Hive.app\` from the DMG into \`/Applications\`. Replace existing when asked. First launch: right-click → Open (unsigned; macOS asks once).

---

## [2.8.4] — 2026-08-24

#### v2.8.x rollup — Accent Round 2 UI craft + Overview clarity

First public v2.x release. Bundles every fix since v1.7.159.

##### Highlights
- **Overview page** — new app-level dashboard across all projects + agents (KPI cards, Working now, Loaded/Closed sessions, project grid)
- **Prime/Accent styles + palettes** (Neon Purple / Tech Blue / Future Pink), palette overlays now shift full hue family (bg/border/sidebar)
- **Random pixel avatars** for new agents
- **Chat font size** — global slider in App Settings (11-20px, live scale)
- **Time-since chip** on every agent row
- **Agent row status left-border** (working/waiting/idle at a glance)
- **Overview grouped by project** with pure A-Z sort
- Font system single-family: Inter Tight body + heading + Space Grotesk as `font-display` only
- All emoji in context menus → SVG glyphs
- Project tabs → Linear-style underline
- Dept-card border → design token (was hardcoded purple)

##### Installation
Drag \`Hive.app\` from the DMG into \`/Applications\`. First launch: right-click → Open (unsigned app; macOS will ask once).

---

## [1.7.159] — 2026-08-13

macOS Apple Silicon (M1/M2/M3/M4/M5) build.

#### Install
1. Download `Hive-1.7.159-arm64.zip` below.
2. Unzip → drag `Hive.app` into `/Applications`.
3. First launch: right-click → Open (Gatekeeper — build is unsigned).
4. If it still refuses:
   ```bash
   xattr -dr com.apple.quarantine /Applications/Hive.app
   ```

#### Fixes since v1.7.150
- **v1.7.159** — 5h/7d bar now shows aggregate (was reporting the current-model 0% by mistake — see #33)
- **v1.7.158** — MCP tool permissions (`mcp__server__tool`) now persist across sessions; new "Allow forever" button writes correct bare-name format (#32)
- **v1.7.157** — Deleting an agent now shows a two-step confirmation modal with full blast radius (#31)
- **v1.7.156** — Renaming an agent no longer kills the live chat (#30)
- **v1.7.155** — Warning-retry dismissal + full-grid prompt detection (part of the 5h/7d fix, #29)
- **v1.7.154** — Compact+Resume no longer flashes StartChooser mid-flight (#28)
- **v1.7.152/153** — PTY master fd leak fully closed (#26 / #27)

#### SHA-256
`98f1ce6b2d9db9de7fb2f8ac3676fdac84f56a4e44c71bd2c23441bc3c5ff2d1`

#### Requirements
- macOS 11 Big Sur or later
- Apple Silicon (arm64) — M1 / M2 / M3 / M4 / M5. Intel not built here.
- Node.js 20+ on PATH (Hive spawns `claude` from your shell env)
- `claude` CLI installed (`claude --version` should work in your terminal)

---

## [1.7.126] — 2026-06-01

### Documentation
- **docs/lessons-learnt.md** expanded from a one-line Version-Bump note
  into a structured reference covering Testing (wiring vs pure helpers,
  negative testing, e2e for chat lifecycle, untestable surfaces),
  Subprocess management (cache-every-result, timeout headroom,
  process-group kill, single-flight dedup), Git workflow
  (`--force-with-lease`, post-squash content verification, `--amend`
  safety, worktree-before-branch-delete, squash-merge version
  collapsing), Hive-specific gotchas (Node version mismatch, `.claude/`
  backup, test-worker branch pruning), and Working-with-Claude rules
  (no question-trap UI, "manually verified" ≠ fix, don't conflate
  similar function names). Distilled from the v1.7.121–125 incident
  series.

---

## [1.7.125] — 2026-06-01

### Documentation
- **CHANGELOG.md** back-filled v1.7.107 → v1.7.124 (versions had
  shipped via PR #3 / #4 / #9 / #10 / #8 squashes but the changelog
  stopped at v1.7.106).
- **docs/todo.md** updated to reflect actual issue/PR state.
- **.gitignore** extended for new test-artifact patterns
  (`.claude/agents/hive-agent-*.md`, `test-multi-agent-report/screenshots/`,
  `test-results/`, `playwright-report/`).

---

## [1.7.124] — 2026-06-01  (PR #8, closes #7)

### Fixed
- **ccusage no longer pegs the CPU on large `~/.claude/projects/`
  histories.** On a 790MB / 1183-file history, `ccusage blocks
  --json` takes ~12s at 100%+ CPU because it scans every jsonl
  from scratch with zero caching. Pre-fix Hive amplified this into
  a continuous CPU-burn loop:
  1. Spawn timeout was **10s** → ccusage was killed RIGHT before
     completing, so we never got a result and never cached one;
     every refresh re-spawned from scratch.
  2. `child.kill()` only signaled the npm/node shim — the heavy
     worker kept scanning jsonl files after we'd moved on, leaking
     CPU after the timeout.
  3. Cache was skipped when `pct` returned null (`if (pct)
     usageCache = result`) → if the PTY scrape was failing on the
     user's setup, every refresh re-spawned ccusage even though
     `cc` had completed.
  4. TTL was 30s → on a slow box the ratio of ccusage runtime to
     cache window pegged a core continuously.

  Fix: timeout 10s → **60s** (5x headroom), spawn `detached:true`
  and SIGTERM the whole process group on timeout, extract a new
  `usage-cache.ts` pure helper that **always** caches the result
  (even all-null) to break the thundering-herd loop, bump TTL
  30s → **5min** (account-level usage changes slowly; in-flight
  dedup catches bursts).

### Tests
- 13 new tests across `usage-cache.test.ts` (TTL, single-flight,
  null-caching regression, partial caching, error swallowing) and
  `chat-usage-query.test.ts` (shim-based PATH override for
  spawn/parse/ENOENT paths). Negative test verified.

---

## [1.7.123] — 2026-06-01  (PR #10, squash of v1.7.121–123)

### Fixed
- **5h/7d %% no longer wiped to `—` by cc-only chat:usage
  broadcasts.** `setUsage(u as any)` in HiveChat was a wholesale
  replace; chat.ts emits cc-only broadcasts (`{ ...(cc||{}),
  ...(pct||{}) }`) after compact when the PTY scrape returns
  null, which wiped fiveHour/sevenDay every refresh and showed
  `—` in the bar. Fix: merge incoming partial usage into prev
  state (`setUsage(prev => mergeUsage(prev, u))`), preserve
  account-level fields on explicit reset
  (`preserveAccountUsage`). Negative-test verified.

### Tests
- New `usage-state.ts` pure helpers (`mergeUsage` /
  `preserveAccountUsage`) with `usage-state.test.ts` (10 unit
  tests) and `usage-merge-wiring.test.tsx` (3 integration tests
  on the actual wired component — mount HiveChat, mock
  `window.api`, verify cc-only broadcast does NOT wipe).
- **New e2e chat lifecycle coverage** (4 specs / 7 tests, closes
  the gap that let three regressions ship in v1.7.103 / .108 /
  .115):
  - `project-lifecycle.spec.ts` — Add → Create → Delete (no claude)
  - `agent-lifecycle.spec.ts` — New Agent wizard → Delete (no claude)
  - `chat-basic.spec.ts` — open agent → send → assistant reply
    + 5h/7d %% numeric (1 claude turn)
  - `chat-compact-resume.spec.ts` — compact + close, asserts the
    5h %% does NOT blank to `—` (2 claude turns; the exact
    regression v1.7.121 closes)

---

## [1.7.121] — 2026-05-30  (PR #9)

### Added
- **Startup gates on `claude` CLI presence with a one-click
  install screen.** For open-source distribution: if the `claude`
  binary can't be run, Hive shows a single **ClaudeGate** screen
  instead of silently failing. Check via PATH only
  (`execFileSync('claude', ['--version'])` — no node/npm/nvm,
  no version policing). Two install paths: copyable official
  `curl … | bash`, or an "Install for me" button that runs the
  same node-free installer, streams output, and re-checks.
  "Continue anyway" escape hatch always available. Headless/e2e
  short-circuits `claude:status` to `installed` so the gate
  never blocks tests.

---

## [1.7.120] — 2026-05-23  (PR #4 squash of v1.7.114 → v1.7.120)

### Fixed
- **E2E suite is now headless + serial.** `HEADLESS=1` env var
  prevents Playwright/Electron from popping windows during CI/local
  runs. `playwright.config.ts` pinned to `workers: 1` so concurrent
  e2e runs never compete for ports / HIVE_DATA_DIR / IPC handlers.
  Repaired 3 test-drift bugs that had crept in since v1.7.113.
- **Integration spec** preflights `claude --version` so missing-CLI
  failures surface as a clear error message instead of a 60s timeout.

### Added (v1.7.117–v1.7.118 inside the squash)
- **Lazy boot fetch + compact watchdog cancel** — renderer no longer
  blocks on a full data load before the first paint. Compact-in-progress
  watchdog cancels cleanly when the user cancels the operation.
- **Send button + draft queue disabled during /compact** so user input
  isn't silently lost while the session is reloading.
- **Agent status reflects the running sub-agent** in the sidebar.

### Added (v1.7.115–v1.7.116 inside the squash)
- **Auto-open chooser on session exit** so the user immediately sees
  resumable sessions instead of a blank chat surface.
- **Picker auto-confirms when only one session is available**; clears
  orphaned pending state when `claude` exits unexpectedly.
- **E2E isolation hardening** + 120s test timeout for slower CI boxes.

### Added (v1.7.114 inside the squash)
- **AskUserQuestion inline rendering** in the chat timeline (no modal
  popup), permission-request queue, sign-in modal, `ErrorBoundary`
  around the chat surface, IPC error surface with structured `{ok,
  error}` returns, `isArray` defensive guards in renderer reducers.
- **PATH hydration on main start** so child processes inherit the user's
  shell PATH; crash-log persisted to `~/.hive/crash-log.jsonl`; new
  auth IPC; fixed a stale-handler race in `ipcMain.removeHandler`.
- **Dev workflow doc** (`58650ba`) enforcing test coverage + commit
  hygiene + isolated e2e.

### Infrastructure
- `.nvmrc` pins Node 22 for Vite 6 / vitest 4 compatibility
  (`crypto.hash` API, std-env ESM/CJS conflict).
- `vitest.config.ts` → `.mts` to bypass the same ESM/CJS resolution
  issue.
- `chat.ts` split into focused modules (`chat-usage-query.ts`,
  `chat-context-parser.ts`, `chat-recent-sessions.ts`).

---

## [1.7.113] — 2026-05-14  (PR #3 squash of v1.7.108 → v1.7.113)

### Fixed
- **Links open in the system browser** instead of inside the Electron
  shell window (`shell.openExternal` wired correctly).
- **Resume + Compact+Resume buttons are always actionable** — pre-fix
  they stayed disabled after a child exit 143, leaving a session
  permanently unrecoverable.
- **`startChat` ignores dead session entries** (child=null) when
  starting a new chat, so a stale Map entry no longer blocks `chat:start`.

### Refactored
- **`chat.ts` split into focused modules** for maintainability (the
  groundwork for the loading-ux landing in v1.7.114+).

### Fixed (v1.7.111 inside the squash)
- **`Compact + Resume` no longer disabled after exit 143.** The
  renderer's `sessionActive` state didn't reset cleanly after `claude`
  was SIGTERM'd, so the action toolbar stayed greyed out.

### Fixed (v1.7.110 inside the squash)
- **Auto-resume on unexpected SIGTERM** — when `claude` is killed by
  the OS (OOM, signal from another process), Hive now offers an inline
  Resume action instead of leaving the user with a dead chat surface.

### Fixed (v1.7.109 inside the squash)
- **Context % was not showing on initial paint.** Now inferred from
  the model name when stream-json hasn't yet emitted the first
  rate_limit_event.

### Fixed (v1.7.108 inside the squash)
- **Subscription %% banner regex** updated to match both old and new
  `/usage` TUI formats (Claude refactored to inline `5h: ░░░░ 23%` in
  2.1.x).
- **"close" sidebar action returns the user to the fleet view** instead
  of stranding them on an empty chat surface.
- **"Set note" modal** for right-click → attach free-text note.

---

## [1.7.107] — 2026-05-08

### Fixed
- **Dropped committed runtime symlink** that broke `npm install` on
  clean checkouts.
- **`electron-builder.files`** scoped to actual ship-artifacts so the
  packaged `.dmg` is no longer ~3× the necessary size.

---

## [1.7.106] — 2026-05-08

### Fixed
- **Compact + Resume no longer silently no-ops when a stale child
  `--print` is tracked under the same id.** `chat:start` IPC bailed
  with `already_started` whenever `sessions.has(id)`, which made the
  entire forceCompact branch unreachable — `compact-log.jsonl` had zero
  entries today despite repeated user clicks. The full Hive process
  restart in v1.7.105 cleared the Map by accident, masking the bug.
  Now `stopChat(id)` runs first to free the stale child; sid + JSONL
  are untouched (compact still operates on the JSONL via
  `runCompactViaPrint` with the same sid), so this remains compact
  semantics, NOT fork.

---

## [1.7.105] — 2026-05-08

### Fixed
- **"↻ Restart terminal" now compacts the live chat too.** v1.7.104 made
  refresh in-place — which fixed the white flash but silently removed
  the "click Compact + Resume in chooser" workflow users relied on each
  refresh, so context never got compacted. `compact-log.jsonl` confirmed:
  last successful compact 2026-05-07 07:47, zero entries afterward.
  Refresh now also fires `chat.compact(chat-<agentId>)` after the PTY
  respawn — runs `/compact` via `--print --resume <sid>` and respawns
  the chat session at the compacted state. No-op when there's no live
  session, so it's safe to fire unconditionally. Tooltip updated to
  "Restart terminal + compact & resume chat".

---

## [1.7.104] — 2026-05-07

### Fixed
- **"↻ Restart terminal" no longer white-screens.** The button used to
  remove the agent from `activeTerminals`, then `setTimeout(startAgent,
  200)` to re-add. During those ~200–400ms (longer if `startAgent` did
  worktree setup), nothing rendered for that agent slot — on light theme
  it showed as a white flash. Worse, on remount the HiveChat overlay
  resurrected with `chooserMode=true`, forcing the user to click Resume
  again. Refresh now reloads data, rewrites the agent definition file
  (so soul/skill changes propagate), then dispatches a
  `hive:pty-respawn` CustomEvent — Terminal listens, kills + recreates
  its PTY in place, and the chat session above it is left untouched.

---

## [1.7.103] — 2026-05-05

### Fixed
- **Ctx % bar now updates from every assistant event, not just turn-end
  `result` events.** Long-running agents (multiple long-lived agents hit
  this) accumulate hundreds of thousands of context tokens across an
  agentic turn, but `result` events only fire when the turn completes
  with `stop_reason=end_turn`. Sessions stuck mid-loop, or sessions read
  from JSONL replay (which never persists `result`), left the bar at
  "context —". The early-return that was added to suppress duplicate
  rendering of cumulative `assistant` snapshots was also skipping usage
  extraction; moved usage extraction ABOVE the early-return so live and
  historical events both feed the ctx % counter. Verified against
  ~/.claude/projects/.../*.jsonl: alex-data 556k tokens, david 557k,
  another-agent 421k — all now visible.
- **Agent header "current task" pill rehydrates on app restart.** The
  pill is fed by `agent:report` IPC events (`task_start` / `task_done`
  emitted by `.claude/hive-report.sh`). State was renderer-only, so a
  Hive restart wiped it and the header showed empty until the agent
  fired its next `task_start` — which for long-running agents could be
  hours or never. App now scans each agent's `~/.hive/logs/<id>.json`
  on mount, picks the latest `task_start` / `task_done`, and seeds
  `agentTasks` accordingly.

### Known issue (data, not code)
- If an agent's `.claude/hive-report.sh` was overwritten with the wrong
  `AGENT="…"` line (happens when worktrees were briefly cross-linked),
  reports go to the wrong agent's bucket. Fix: click the "↻ Restart
  terminal (reloads data)" button in the chat header — that re-runs
  `writeAgentDefinition` and rewrites the script with the correct ID.
  Confirmed bad scripts on this machine: `example-project-agent-a` and
  `example-project-agent-b` (both currently have a stale peer's id baked in).

---

## [1.7.102] — 2026-05-04

### Added
- **Right-click an agent in the sidebar to attach a free-text note** —
  e.g. "fixing flaky test #123", "waiting on Tom's review". The note
  replaces the role line under the agent's name (Zest italic + 📝 prefix)
  so you can see at a glance what each agent is mid-flight on.
  Right-click again → Edit / Clear. Stored on the Agent object alongside
  `tagColor`, persists with the rest of the agent state.

---

## [1.7.101] — 2026-05-03

### Added
- **`✦ Start New Session` in the kebab menu (active session).** The
  `startNewSession()` function existed since the start-chooser was
  introduced but was only reachable AFTER closing the session — once
  inside an active session, the kebab only offered Compact + Fork
  (carries summary as seed) and Resume (carries full context). Neither
  one corresponds to "clean slate, agent has no memory of prior
  conversation". Now exposed as a 4th menu item between Resume and
  Remote Control. `onFork` ≠ `onNewSession`: Fork preserves a compacted
  summary; New starts blank.

---

## [1.7.100] — 2026-05-03

### Fixed
- **File Explorer now loads the full project tree.** `fs:scanFiles` had a
  `files.length > limit * 2` early-bail that fired mid-DFS, so any project
  with >1000 files (e.g. `example-project-agent-big` at 14k files,
  `question-bank/` alone at 4.5k) silently dropped every directory walked
  after the threshold. Refresh re-ran the same broken scan, hence "only
  two folders" symptom. Replaced with three independent guards —
  `MAX_DEPTH=10` (was 5), `MAX_VISIT=50000` files-scanned ceiling, and a
  3s wall-time cutoff — and bumped the renderer-side limit from 500 → 5000
  so 4.5k-file folders actually render in the tree.
- **Tasks parse failures now surface in the console.** `listTasks()` was
  silently swallowing `JSON.parse` errors with `catch { return null }`,
  meaning corrupted task files vanished from the UI without warning. Now
  logs `[tasks] parse failed: <file> <message>`.

### Security
- **Hardened all `git:*` IPC handlers against shell metacharacter
  injection.** `git:commitHistory`, `git:createTargetBranch`,
  `git:currentBranch`, `git:worktreeAdd`, `git:worktreeRemove`,
  `git:worktreeList`, `git:createIntegration`, `git:clone` all migrated
  from `execSync` with template-literal interpolation (`git -C "${repoPath}"
  branch ${branch}`) to `execFileSync('git', [...args])` argv form, which
  bypasses the shell entirely. Branch names, paths, and clone URLs from
  external sources can no longer break out of arguments. Also clamps `days`
  on `git:commitHistory` and `batchNum` on `git:createIntegration` to
  integers to prevent any other unsafe input.

### Changed
- **Pause button (Task Group toolbar) is now visibly disabled** with a
  `Pause coming in v0.10.0` tooltip, instead of looking clickable but
  doing nothing on click.

---

## [1.7.74] — 2026-04-27

### Fixed
- **RateLimitBar countdown now ticks live.** `resets in Xh Ym` and
  `⏱ auto-continue in Xh Ym` were rendered once and frozen — only
  updated when the next stream event happened to re-render the
  component, so a long-rejected session showed stale time forever.
  Added a 60s heartbeat (matches `humanEta`'s minute resolution
  exactly) that bumps a force-render counter and cleans up when
  neither `resetsAt` nor `autoContinueAt` is set.

---

## [1.7.73] — 2026-04-27

### Added
- **ActionToolbar above input bubble** — utility row with always-on
  Compact button + `⋮` kebab dropdown for other session actions.
  Layout: `ctx 22%` chip on the left (when known) / `[Compact] [⋮]`
  on the right. Compact button border + label escalate with ctx %:
    - `< 60`: Charple border, label "Compact"
    - `60-79`: Zest border, label "Compact (⚠ 68%)"
    - `>= 80`: Sriracha border, label "Compact (⚠ 88%)"
  `⋮` dropdown contains: Compact + Fork / Resume Session / Remote
  Control / Close Session — consolidating session-level actions
  that previously lived in the bottom ModelUsageBar. Click-outside
  closes the menu.
- **Floating scroll-to-bottom button** — appears at the right edge
  above the toolbar when the user has scrolled up from the live
  edge (`distFromBottom > 60px`). Charple circular button with `↓`
  glyph; hover lightens to Violet. Click → scroll to bottom and
  resume auto-scroll. Auto-scroll on new messages now ALSO respects
  scroll position: if user is reading older content, new live events
  no longer yank them down.

### Tests
- `selectCompactBtnTier(pct)` (3 case groups, 9 assertions) added.
  Total now 32 files / 452 tests pass.

---

## [1.7.72] — 2026-04-27

### Fixed
- **Ctx % bar overflowing 100% (alex(data) flashed 181%)**. Two
  bugs combined to produce wildly wrong context-size readings:
  1. `result.usage.cache_read_input_tokens` is the CUMULATIVE sum
     across every iteration of an agentic turn — each tool call
     re-reads the prefix from cache and the running total is
     reported. For long turns this balloons to multiples of the
     context window (saw 25M on a 1M model). Fix: use
     `iterations[-1]` per-iteration values; fall back to top-level
     only when `iterations` is absent.
  2. Subagent `result` events carry their own independent usage and
     were overwriting the parent's ctx number. Fix: skip
     `setLatestInputTokens` when `parent_tool_use_id != null`. The
     subagent result entry is still added to the timeline (with
     `isSubagent: true` so renderer dims it), just not used for
     the parent's bar.

### Added
- **Context-pressure nag banner** at 80% (warn, Zest border + bg
  tint) and 90% (urgent, Sriracha). Sits above the Subagent /
  RateLimit row. Each tier dismissable independently with `✕`;
  both reset when ctx drops by ≥ 30% (= a /compact ran). Inline
  `Compact now` button runs the same path as typing `/compact` in
  the input box. Typed `/compact` was already supported (no change
  there) — the banner adds passive prompting + 1-click trigger.

### Tests
- `parseContextSize(s)` (5 cases) and `selectCtxNagTier(pct, dismissed)`
  (3 case groups, 11 assertions total) added to `progress-bar.ts`.
  449 tests across 32 files pass.

---

## [1.7.71] — 2026-04-26

### Changed
- **Subagent prompt bubble re-styled (final).** v1.7.70 stripped to
  plain Ash text per first-pass user feedback; user followed up
  "可以和 user input 样式类似，换个颜色就行" — i.e., keep the
  user-bubble shape, just recolor. Settled on:
    - bg: `rgba(107, 80, 255, 0.12)` (Charple at 12% — same opacity
      shape as the Dolly user bubble, different hue)
    - border: 1px Charple `#6B50FF`
    - prefix: `❯` Charple (was Julep on user input)
    - text: Ash `#DFDBDD` (slightly dimmer than Butter)
  Real human input still renders Dolly + Julep ❯ + Butter — `isSubagent`
  prop only flips when stream event has `parent_tool_use_id` set.

### Tests
- Extracted `computeGrainBar(pct, total)` math into
  `progress-bar.ts` and added 6 vitest cases (clamping, NaN/undefined,
  rounding, custom total, filled+empty invariant). 32 test files /
  444 tests now pass.

---

## [1.7.70] — 2026-04-26

### Fixed
- **Subagent prompts no longer rendered with user-input style.**
  Stream events with `parent_tool_use_id != null` come through as
  `kind: 'user'` (subagent's view: "what the parent told me to do"),
  but they're NOT real user input. v1.7.64 wrapped them in a
  Mochi-bordered SUB container, but the inner content still ran
  through `UserMessage` which slapped on the green Julep `❯` prefix
  and Dolly pink bubble — making subagent prompts look identical to
  things the human typed. Now `UserMessage` takes an `isSubagent`
  prop: when true, render as plain Ash `whiteSpace: pre-wrap` text
  with no bubble or `❯`. Real user input is unaffected (no
  `parent_tool_use_id` → `isSubagent` stays false → original style).
- **Progress-bar grain visible against panel bg.** `░` empty cells
  were Charcoal `#3A3943` against BBQ `#2D2C35` — only ~13 channels
  of contrast, basically invisible. Switched to Oyster `#605F6B`
  (~50 channels) so the grain reads clearly. `ui-preview-crush-elements.html`
  was wrong; updated alongside.

---

## [1.7.69] — 2026-04-26

### Added
- **Auto-continue after rate-limit reset.** When claude emits a
  `rate_limit_event` with `status: "rejected"` (5h or 7d cap hit and
  org-level overage disabled), the main process schedules a one-shot
  `setTimeout` for `resetsAt + 60s` that injects a normal user input
  (`"Limit reset — please continue."`) into the live `--print` stdin.
  No `--resume` needed — empirically the `--print` subprocess stays
  alive through `rejected` (verified against alex(data)
  `chat-agent-1774186235213-1777124830944.jsonl` line 41674); only the
  in-flight API call gets blocked.
  - State persists to `~/.hive/chat-auto-continue.json` so app
    restart re-arms the timer (entries older than 5min past their
    fire time get dropped).
  - RateLimitBar shows `⏱ auto-continue in Xh Ym` Charple text plus a
    `cancel` button. `chat:cancelAutoContinue` IPC clears both the
    timer and the persisted entry.
  - Only one timer per rejection epoch — many tool calls in a single
    turn each emit their own `rate_limit_event`, so we gate on
    `!session.autoContinueTimer`.
  - Status color in RateLimitBar widened: `rejected` now renders
    Sriracha (was generic Zest fallback).

---

## [1.7.68] — 2026-04-26

### Changed
- **"Load earlier" cap is temporary, not permanent.** Previously v1.7.66
  raised the live cap by `entries.length` on each load-older click —
  loaded entries persisted forever, growing memory unboundedly. Now
  the cap is temporarily raised AND a buffer counter (=10) is armed.
  Each genuine live entry — main-agent user/assistant/tool addition,
  excluding subagent noise (`parent_tool_use_id != null`) and
  in-place streaming-text replacements — decrements the counter.
  When it hits 0, cap snaps back to 500 and the loaded-older block is
  trimmed in one go. Lets you read 200 loaded entries comfortably
  before the next 10 real conversational turns push them off.

---

## [1.7.67] — 2026-04-26

### Changed
- **Status-bar progress bars now match `ui-preview-crush-elements.html`
  pixel-for-pixel — grain text glyphs (`█` / `░`) instead of CSS color
  fills.** All three indicators (`ctx`, `5h`, `7d`) render as 10-char
  monospace bars: filled `█` chars in the indicator's color, empty
  `░` (light shade / "grain") in Charcoal `#3A3943`. Matches the Crush
  TUI source. Default fill = Julep `#00FFB2`; `ctx` keeps its dynamic
  Bok → Zest → Sriracha threshold coloring at 70 / 85.

---

## [1.7.66] — 2026-04-25

### Fixed
- **"Show earlier messages" no longer vanishes**. Clicking the
  Load-older button prepended history into `timeline`, but a fixed
  `MAX_LIVE_ENTRIES = 500` cap then sliced the just-prepended
  oldest rows on the very next stream event — so the new rows
  appeared and disappeared within a frame. Replaced with a
  `liveLimitRef` that grows by `entries.length` on each prepend,
  so the cap respects loaded history. Live cap still starts at
  500 to bound memory on long fresh sessions.

---

## [1.7.65] — 2026-04-25

### Added
- **Sticky `Subagent #N` banner** above the rate-limit row whenever
  a Task tool's subagent is actively running. Tracks active
  subagents by `tool_use_id`, populated on Task `tool_use`,
  refreshed on every `system.subtype: task_progress` event (claude
  tells us what the sub is doing right now), removed when the
  matching `tool_result` arrives. Shows:
    `⏳ Subagent #1   Reading regen-batch2-handbook.md…   2 tools · 21K tok · 3.5s`
  - Charple `#6B50FF` color scheme (Crush purple, matches tool-block
    border / summary tag family).
  - Title-case "Subagent" with always-shown `#N` index assigned by
    insertion order (resets when sub finishes).
  - Hourglass `⏳` rotates 180° via `hg-flip` keyframe.
  - Animated `…` ellipsis loader (CSS-only `hive-dots` keyframe)
    after the description so you can see "still moving" even between
    `task_progress` events.
  - 1Hz tick keeps elapsed-time live.
  - **Idle detection**: if no event in 60s the row tints Zest, ⏳
    stops rotating, dots freeze — visual "stuck not slow" signal.
  - Multiple concurrent subagents stack as separate rows.

---

## [1.7.64] — 2026-04-25

### Fixed
- **Context %% bar showed 0% when prompt cache was warm.** Was using
  only `result.usage.input_tokens` (this turn's *new* tokens — `6`
  when cache served the rest). Now sums `input_tokens +
  cache_read_input_tokens + cache_creation_input_tokens` for the
  real loaded-context size. Auto-compact heuristic adjusted to use
  the same total.
- **Subagent prompts no longer render as fake user inputs.** Stream
  events with `parent_tool_use_id != null` (subagent's user/assistant
  turns relayed in parent stream) used to render as full UserMessage
  / AssistantMessage / ToolBlock with main-chat styling — the Task
  prompt to a subagent appeared as a Julep ❯ + Dolly bg bubble like
  the human typed it. Now: still rendered (so you can see what the
  subagent's doing) but wrapped in a Mochi-bordered indented dim-
  opacity container with a tiny `SUB` badge on the left. Click
  handlers (✓ / ✏ / ↺) suppressed inside subagent rows since they
  don't belong to the user's main thread.
- **`⏳` hourglass spinner now animates.** Was static text. Added a
  `hg-flip` CSS keyframe that rotates the glyph 180° every 2s so it
  visibly "tips" while the gradient text scrolls.

---

## [1.7.63] — 2026-04-25

### Added
- **Smart-startup auto `/compact`.** Every `chat:start` with
  `continueSession: true` now scans `~/.claude/projects/<cwd>/*.jsonl`
  for the latest session, reads its last `result.usage.input_tokens` /
  `modelUsage.contextWindow`, and if > 50% runs `/compact` via a
  brief PTY round-trip BEFORE the actual `--print --resume <sid>`
  spawn. Otherwise falls through to plain `-c` startup. Every Hive
  open of a long-lived agent gets auto-thinned context — no more
  cache-miss + huge-context hangs on resume.

### Changed
- Chat background `#170d2e` → `#150e24` to match `--sidebar-bg`
  (project list panel) in dark mode. Slightly less blue, warmer
  purple tone.

---

## [1.7.62] — 2026-04-25

### Added
- **Smart Resume button.** Closed-panel resume reads the session
  JSONL's last result event; if prior context > 50% runs `/compact`
  via PTY round-trip before re-spawning `--print --resume <sid>`,
  else just resumes. No more hangs from cache-miss on big sessions.
- **"Start with summary" button.** `/compact` + `--resume <sid>
  --fork-session` — new session-id with the compacted summary as
  seed context. Middle ground between full Resume and amnesia New.
- **`/compact` slash command** in the input box. PTY round-trip
  pattern: kill `--print` → spawn PTY `--resume <sid>` → write
  `/compact\r` → wait for prompt-return → kill PTY → respawn
  `--print --resume <sid>`.
- Closed-panel now shows THREE buttons: `↻ Resume / ≡ With summary
  / ⊕ New`, each labeled with its memory-persistence semantic.
- New `StartOpts.forkSession` flag wires `--fork-session` to the
  spawn. New IPCs: `chat:compact` / `chat:resumeSmart` /
  `chat:startWithSummary`.

### Fixed
- **Exit code `null` → `0`** when claude `--print` is killed by
  signal. The renderer's `useState<number|null>(null)` made the
  closed-panel never render because `exited !== null` stayed false.
  Coercing `null → 0` fixes the panel showing after close-confirm.

---

## [1.7.61] — 2026-04-25

### Changed
- **`--` separator suffix not prefix.** Pencil ✏ now appends
  `<content> --\\n` instead of `-- <content>\\n`. Caret lands on a
  fresh line after the quoted content, ready for the user's reply.

---

## [1.7.60] — 2026-04-25

### Removed
- Temporary `console.log` debug statements in `handleRespond` after
  v1.7.59's pointer-events fix verified working.

---

## [1.7.59] — 2026-04-25

### Fixed
- **Pencil ✏ click did nothing in v1.7.58.** The lucide SVG inside
  the `<button>` was capturing clicks before they bubbled to
  `onClick`. Adding `style={{ pointerEvents: 'none' }}` to both
  Check + Pencil SVGs lets clicks pass through to the parent button.
  Same fix applied to Check icon defensively.

---

## [1.7.58] — 2026-04-25

### Changed
- **Choice-row icons swapped to `lucide-react`** Check + Pencil
  components (`size={12}`, `strokeWidth` 2.4 / 2.2). Replaces the
  prior Unicode `✓` + emoji-y `✏`. Adds `lucide-react ^1.11.0` dep.

---

## [1.7.57] — 2026-04-25

### Changed
- Replaced Unicode `✏` (heavy emoji-style glyph) with a thin inline
  SVG pencil. Same Charple stroke. *(Subsequently swapped to
  lucide-react Pencil in v1.7.58.)*

---

## [1.7.56] — 2026-04-25

### Fixed
- **Choice-row border style restored.** v1.7.53 dropped the original
  v1.7.x choice-button border when adding the per-row ✓/✏ icons —
  rows became flat divs with no visual cue they were selectable.
  Border (1px Charcoal → Charple on hover) + 6px border-radius +
  6/12 padding restored. Hover still reveals the action icons; the
  whole row also tints Charple at 8% on hover for clarity.
- **InlineResult cap label** no longer concatenates lines + chars
  ("X more lines · Y more chars"). Caps are now strictly one-or-the-
  other: `lines > 12` truncates by lines, ELSE `chars > 800`
  truncates by chars. Whichever exceeds threshold first owns the
  truncation; never mix. Lines have priority — if both would fire
  in theory, the line cap runs and chars are ignored.

### Added
- **Subscription reset countdown next to each %% bar.** /usage TUI
  scrape now also extracts the "Resets in 4h 12m" / "Resets on
  Apr 30" string per section. ModelUsageBar renders it next to the
  corresponding %%:
    `5h ▰▰ 23% · in 4h 12m   7d ▰ 5% · in 6d 14h`
  String is verbatim from claude (could be relative or absolute
  depending on how /usage formats it).

---

## [1.7.55] — 2026-04-25

### Fixed
- **InlineResult collapse caps now apply cumulatively.** Old logic
  was `if byLines || byChars: pick one branch and slice`, which
  meant a `head -10` Bash result with 25 short lines × 25 chars =
  625 chars would slice to "first 600 chars" → ≈ 24 visible lines
  (slipping through the 12-line gate entirely). Now: trim by lines
  first (cap 12), then char-trim the line-trimmed result (cap 800).
  Whichever cap bites tighter wins. Per-tool 8-line Bash special
  case dropped — the new cumulative rule handles wide-line Bash
  correctly without needing a special threshold. Hidden label now
  reports both numbers when both fired (`X more lines · Y more chars`).

---

## [1.7.54] — 2026-04-25

### Refactored / Added
- Extracted structured-output parsing from `formatStructuredOutput`'s
  inline body into a new pure module `structured-format.ts` exposing
  `parseStructuredLine` / `parseStructuredOutput` / `glyphColor` plus
  the `StructuredLine` / `StructuredSegment` types. The renderer
  helper now only handles JSX → still does same thing visually.
- 19 new vitest cases covering: glyph color mapping (`✓ ✔ ●` →
  Julep, `✗ ❌` → Sriracha, `⚠` → Zest, fallback → Ash); heading
  detection (`=== Title ===` requires 3+ equals + surround whitespace,
  rejects `===title===`); blank line; mixed-script titles (CJK);
  inline glyph splitting + text segment ordering; multi-glyph lines
  with different colors; whitespace preservation; multi-line input
  parsing; realistic 8-task stem-regen sample. Total: 419 → 438.

---

## [1.7.53] — 2026-04-25

### Changed
- **Trailing list rendering** no longer assumes the list is a "pick
  one" question. stream-json doesn't distinguish a real choice
  question from a TODO / next-steps list — both are plain markdown.
  So instead of guessing, every numbered/lettered trailing list
  item now renders as a regular line with two hover-revealed
  action icons on the right:
    - **✓ (Julep)** — treat this row as my reply (existing onChoose
      behavior: re-send the raw line as a user message).
    - **✏ (Charple)** — quote this row into the input box prefixed
      with `-- ` so the user can append a free-form response, then
      hit Enter when ready.
  Hovering the row also shifts its background to a subtle Charple
  tint so it's clear which item the icons act on. Works whether
  claude is asking a real question OR dropping a next-steps list —
  same UI, no detection needed.

---

## [1.7.52] — 2026-04-25

### Fixed
- **Permission allow was rejected by claude with a Zod error** for any
  tool with non-trivial permission shape (Skill, custom MCP). v1.7.21
  changed the deny payload correctly but missed adding `behavior:
  "allow"` to the allow branch — sent `{updatedInput: ...}` alone.
  Both branches of the union require `behavior`. Symptom: ⚠ "Tool
  permission request failed: ZodError: invalid_union ..." in the
  timeline whenever the user clicked Allow on a Skill call. Fixed:
  allow now sends `{behavior: "allow", updatedInput: <input>}`.

### Added
- **Bullet-point styling** for markdown `<ul>` lists in HiveChat:
  `▸` Charple `#6B50FF` markers replacing the default browser disc.
  Matches the chat's other "next-tier" Charple accents (tool block
  border, summary tag, auto-compact divider). Numbered lists `<ol>`
  unchanged — the digit itself is information. Scoped via
  `.hive-chat-md` class so xterm Term + the rest of the app are
  unaffected.

---

## [1.7.51] — 2026-04-25

### Added
- **● Julep status dot on every assistant text reply** — symmetric to
  the Julep `❯` on user input. Tool calls keep their per-tool ●;
  this is for plain-text replies that previously had no visual
  marker.
- **`[SUMMARY]` tag** when the reply starts with a recognized
  summary marker (`Summary:` / `## Summary` / `**Summary**` /
  `总结：` / `结论:` / `小结` / `Final Report`, case-insensitive,
  with or without inline title). Tag is Julep-bordered uppercase
  badge; an optional title (text after the colon) renders as a
  Butter subtitle. Heading line is stripped from the body so the
  markdown content flows naturally below.
- 11 new vitest cases for the new `detectSummary` helper covering
  no-marker / plain prefix / `## Summary` / bold / Chinese variants
  / case-insensitivity / blank-line stripping / mid-text rejection.
  Total: 408 → 419.

### Changed
- **Agent panel R&D / Non-R&D card borders** changed from
  `border-border/50` (resolved to a near-invisible gray-purple) to
  solid Charple `#6B50FF` — same purple as the chat tool-block
  vertical line. Borders now read as deliberate frames, not
  accidental.

---

## [1.7.50] — 2026-04-25

### Changed
- **Close-session confirm is now a panel**, not a button-row. Click
  `close ✕` on the bottom bar → input area swaps to a Sriracha-bordered
  confirm panel with explanatory copy + `[Cancel] [OK · close session]`.
  Cancel reverts to the normal textarea. OK fires the actual stopChat
  → existing "session closed" + Start new session panel takes over.
  Same destination as v1.7.49 but the confirm UI is in the panel
  zone where the user is already looking, not crammed into the
  status bar.

---

## [1.7.49] — 2026-04-25

### Changed
- **Close session is now two-step.** First click on `close ✕` expands
  the button into `[cancel] [confirm close ✕]`; only the second click
  on confirm actually kills the subprocess. Confirming state
  auto-reverts after 4s of inactivity so a stray click can't strand
  the bar in confirm-mode. Killing a running session was too
  destructive for a single-click hit.

---

## [1.7.48] — 2026-04-25

### Added
- **Stop reason badge** on the result summary card. When
  `result.stop_reason !== 'end_turn'` the card label flips from
  `TURN COMPLETE` to `STOPPED: <reason>` with a colored left border:
  Sriracha for refusal / max_tokens / model_context_window_exceeded,
  Zest for pause_turn / tool_use, Squid for unknown. Refusals are
  now impossible to miss.
- **File-link click** in tool headers opens with default app via
  `shell.openPath`. Shift/Alt-click reveals in Finder. URLs (WebFetch
  / WebSearch) route to default browser. Existing `revealInFinder`
  handler kept untouched for compatibility.
- **Code-block copy button** on every fenced markdown code block.
  Hover reveals a Charcoal-bordered `📋 copy` button at the top-right;
  click → navigator.clipboard.writeText, badge swaps to Julep
  `✓ copied` for 1.5s, then fades.

### Backend
- New `fs:openPath` IPC + `window.api.fs.openPath(path)`. Calls
  `shell.openPath`; "" return = success, otherwise error string.

---

## [1.7.47] — 2026-04-25

### Fixed
- **`❯` prompt glyph color restored to Julep mint green** per
  `ui-preview-decorations.html` (the design contract). It had drifted
  to Dolly pink in a recent change — both the input box prompt and
  the sent-message bubble's prompt are now back to spec.

### Added
- **Structured Bash output formatting.** `=== Title ===` heading lines
  in tool results now render as BBQ-backed cards with a Charple left
  border. Inline glyphs get colored: `✓` `✔` `●` → Julep, `✗` `❌` →
  Sriracha, `⚠` → Zest. Other content passes through unchanged. Makes
  scripts that print `=== 8 tasks done ===` followed by `✓ id1  ✓
  id2` look like a proper summary rather than ASCII soup.

---

## [1.7.46] — 2026-04-25

### Added
- **Drag-and-drop file → input box** in HiveChat. Drop one or more
  files anywhere on the chat surface (from FilesPanel or Finder) and
  their absolute paths get appended to the textarea, quoted if the
  path contains spaces, separated by spaces, then the input is
  focused so you can keep typing. Plain-text drops (e.g. selected
  text from another editor) work too. Mirrors Terminal's existing
  drop behavior, just routed to the chat input instead of the PTY.

---

## [1.7.45] — 2026-04-25

### Fixed
- **Subscription %% (5h / 7d) silently went blank for every agent
  after v1.7.31's shared cache.** Root cause: I switched the cold-
  scrape PTY's `cwd` from each agent's project dir to `$HOME` to
  make the cache feel "global". But interactive `claude` gates input
  on a workspace-trust dialog the first time it sees an unfamiliar
  directory. `$HOME` had never been opened as a project → trust
  dialog → `/usage\r` never sent → 25s timeout → cache filled with
  `pct: null`. Every subsequent agent refresh hit that null cache.
  Fix: caller passes its `cwd` (an already-trusted agent project),
  and we skip caching a null result so the next refresh gets a
  fresh chance with potentially a different (trusted) cwd.

---

## [1.7.44] — 2026-04-25

### Changed
- Reordered ModelUsageBar: `model (1M) ctx 47% | 5h 23% 7d 5%   • streaming  close ✕`.
  Context %% lives next to `(1M)` because both describe "this session's
  context window"; subscription `5h` / `7d` are account-level and live
  on the other side of the `|`. Action buttons stay right-pushed.
- Removed the redundant `4h 12m left` ETA from the bottom bar — the
  RateLimitBar above the input already shows the same reset countdown.

---

## [1.7.43] — 2026-04-25

### Added
- **↺ Recall icon on each sent UserMessage bubble.** Hover over your
  past message → ↺ icon appears at the right → click → fills the input
  box with that text and focuses the textarea. Edit & resend.
  Replaces the ↑/↓ keyboard recall (chat-native: ↑ stays as plain
  textarea cursor navigation). The pure recall.ts helpers + 12 vitest
  cases stay in tree for potential keyboard re-enable later.
- **Long-running tool spinner** under the ToolBlock header when a
  `tool_use` has been issued for >5s without a matching `tool_result`.
  Same Charple→Dolly scrolling gradient as the thinking spinner.
  Verb adapts to tool: `shell still running…` (Bash), `subagent still
  running…` (Task / Agent), `tool still running…` (everything else).
  Silent for the first 5s so quick tools (1-3s) don't flash a spinner.
- **Auto-compact divider** in the timeline. Detected when
  `result.usage.input_tokens` drops by more than half (and ≥30K
  delta) — heuristic for "claude just summarized old turns to free
  context". Renders a Charple gradient bar with summary
  `── auto-compacted · N turns summarized · 180K → 35K ──`. Surfaces
  what was previously a silent event so the user knows the old
  conversation above is no longer in the model's literal context,
  just a summary.

---

## [1.7.42] — 2026-04-25

### Added
- **Stop button (■)** at the right of the input box. Appears only
  while claude is generating (`sending` or `thinking`). Click sends a
  `control_request {subtype: "interrupt"}` to claude on stdin —
  cancels the current turn (mid-thinking, mid-tool-call, mid-text)
  without ending the session. Discovered the protocol by grepping
  the claude binary for `sendControlRequest` patterns.
- **Context window % bar** in the bottom status bar:
  `ctx ▰▰▰▱▱▱▱▱ 47%`. Driven by the latest `result.usage.input_tokens`
  vs the parsed model context window (`1M` / `200K` from system/init).
  Color shifts Bok → Zest → Sriracha as it crosses 70% / 85%, so you
  see auto-compact coming. Hover for raw tokens.

### Backend
- `interruptSession(id)` + `chat:interrupt` IPC. Fire-and-forget; no
  ACK in stream-json land.

---

## [1.7.41] — 2026-04-25

### Fixed
- **Task tool header no longer dumps the full subagent prompt.**
  argSummary used to return `input.prompt` verbatim, which is often
  1k+ chars and reads as a noisy second copy of the user's own
  message that triggered the Task call. New `TaskHeader` component
  renders: `● Task [subagent_type] short-description-or-truncated-
  prompt`. Uses `input.description` (Task's purpose-built short
  field) when present, else truncates `prompt` to 120 chars with
  whitespace collapsed. `subagent_type` shown as a small Dolly badge.

---

## [1.7.40] — 2026-04-25

### Fixed
- **Voice input now reaches HiveChat input.** App.tsx mic was hard-
  writing transcripts to PTY (`window.api.pty.write`); when the user
  was in chat mode, xterm was hidden and transcripts vanished into a
  void. Now: App broadcasts a `hive:voice-final` CustomEvent. Terminal
  listens and writes to PTY only when `chatMode === false`. HiveChat
  listens and appends to its input box (smart whitespace separator so
  multiple voice segments stack naturally).
- Removed Terminal's stale `onTranscript` listener that was double-
  feeding the PTY (raw `final:` prefix was leaking into terminal output).

---

## [1.7.39] — 2026-04-25

### Changed
- Shortened "⏹ close session" → "close ✕" so it doesn't wrap to a
  second line in the bottom status bar on narrower windows. `nowrap`
  added so it never breaks again.

---

## [1.7.38] — 2026-04-25

### Changed
- Bumped HiveChat dark background from `#0f0a1a` → `#170d2e` (slightly
  more violet — same dark feel, more "Crush deep-violet" than
  "almost-black"). User pick after side-by-side.

---

## [1.7.37] — 2026-04-25

### Fixed
- **Markdown tables in Read results no longer get shredded.** Prism's
  markdown grammar emits multi-line tokens for tables (one token whose
  content includes `\n`), which prism-react-renderer's per-line splitter
  fragments — table rows scatter across rendered `<div>`s, every `|`
  ends up on its own line. Fix: `.md` / `.markdown` extensions fall
  through to `markup` (HTML grammar), which is effectively pass-through
  for markdown source without HTML tags. Source displays line-for-line.
  Regression guard added in `renderers-helpers.test.ts`.

---

## [1.7.36] — 2026-04-25

### Fixed
- **`/desktop` polite handover before killing remote-control PTY.**
  `resumeFromRemoteControl` was hard-killing the PTY without first
  releasing the server-side claim that `/remote-control` registered.
  Server thought the session was still mobile-owned → next `--resume`
  could land in stale / partial state and the mobile end might not
  release cleanly. Now: write `/desktop\r` to the PTY, wait 1.5s for
  the handover to settle, then kill + re-spawn `--print --resume <sid>`.

---

## [1.7.35] — 2026-04-25

### Fixed
- **HiveChat now locks to deep-purple `#0f0a1a` background** regardless
  of system / Hive theme. In light mode, `var(--bg-primary)` resolved
  to white and the entire Crush palette (Butter / Ash text + Charple /
  Dolly / Julep accents — all engineered for a dark base) collapsed
  into invisibility. xterm Term tab is unchanged (already dark via
  xterm.js's own theme config).

---

## [1.7.34] — 2026-04-25

### Refactored / Added
- Extract `summarizeFiles(files, cutoffMs)` from storage walker into a
  pure function so the bucketing logic (totals / main vs subagent /
  stale boundaries / topStale ranking) is unit-testable without
  touching the real filesystem.
- 10 new vitest cases covering empty input, total counting, main-vs-
  subagent split, mtime cutoff strict-`<` boundary (both directions),
  stale main/subagent split, topStale capped at 20 + descending sort,
  and a realistic mixed batch. Total: 397 → 407.

---

## [1.7.33] — 2026-04-25

### Fixed
- **Tighter collapse on Bash results.** InlineResult's gates were
  permissive enough that wide-but-few-line Bash output (11 lines × 80
  chars = 880) dodged both byLines (12) and byChars (1200) and dumped
  uncollapsed. Bash / BashOutput now collapse at 8 lines / 600 chars;
  other tools keep gentler caps.

---

## [1.7.32] — 2026-04-25

### Added
- **Built-in cleanup for `~/.claude/projects`** in App Settings →
  Storage. Slider 1-90 days, default 15. Shows total + breakdown
  (main sessions vs subagent transcripts), live size delta as the
  slider moves, two-click delete (Delete → Confirm) so a misclick
  can't nuke things, post-delete summary.
- Verified subagent JSONLs (`subagents/agent-*.jsonl`) are sidechain
  transcripts that Claude's `/resume` picker filters out
  (`isSidechain=true` in binary strings) — safe to delete.

---

## [1.7.31] — 2026-04-25

### Performance
- **Shared `/usage` cache** across all HiveChat sessions. Subscription %%
  is account-scoped — N agents see the same numbers — so spawning N
  PTY scrapes per refresh was wasteful. Now: one process-wide cache
  (TTL 30s) + in-flight promise dedup. Concurrent callers all await
  the same scrape; warm-cache callers return instantly with no PTY.
  Net effect with N agents: 1 PTY for the cold burst (was N), 0 PTY
  during the 30s warm window (was N).

---

## [1.7.30] — 2026-04-25

### Added
- **⏹ Close session button** in the bottom status bar — kills the
  `claude --print` subprocess while keeping the full timeline visible,
  so the user can step away without burning API.
- **⊕ Start new session panel** appears in place of the input area when
  the subprocess has exited (user-initiated or natural). Spawns a fresh
  session with the same agent (no `-c`, no `--resume`); adds a `── new
  session ──` divider to the timeline so the context boundary is clear.
- Close button hidden when not applicable (already closed / in remote-
  control mode) so it never does the wrong thing.

---

## [1.7.29] — 2026-04-25

### Added
- **`/remote-control` round-trip.** Typing `/remote-control` in HiveChat
  triggers a session-scoped slash-command handler that:
  1. Kills the current `--print` subprocess
  2. Spawns node-pty `claude --resume <claude_sid>` (interactive TUI)
  3. Writes `/remote-control\r` after the prompt settles
  4. Forwards PTY stdout to the renderer so pairing URL / QR are visible
  5. Shows a Dolly-bordered pairing panel with a **"↺ Resume session
     here"** button in place of the textarea
  6. Click → kills PTY, re-spawns `--print --resume <sid>`, replay
     picks up any mobile-driven turns
- Backend plumbing generalizes to other session-scoped slashes
  (`/clear`, `/compact`, `/model`) — just add them to the renderer's
  intercept list with the right PTY input.

### Changed
- `ChatSession` gained `mode: 'print' | 'rc'`, `rcPty?`, `claudeSid`,
  `startOpts` fields.
- `sendUserMessage` / `respondPermission` now refuse when
  `mode !== 'print'`.
- `startChat` accepts a new `resumeSid` opt for explicit
  `--resume <sid>` semantics.

---

## [1.7.28] — 2026-04-25

### Added
- **Load older messages** button at the top of HiveChat when a session has
  more JSONL history than the live 500-entry cap. Fetches prior events in
  batches from `~/.claude/projects/<cwd>/<sid>.jsonl` and prepends them to
  the timeline atomically (no scroll flicker).
  - Backend: `replaySessionHistory` now takes `limit=500` and records a
    `(replayFile, replayedFrom)` cursor on the session.
  - New `loadOlderHistory` + `chat:loadOlder` IPC; `chat:prepend:<id>`
    broadcast channel.
- **26 new vitest cases** covering `flatten.ts` (14) and `recall.ts` (12).
  Total cases: 371 → 397.

### Fixed
- `DiffPanel` (Edit / MultiEdit tools) now honours
  `DEFAULT_EXPANDED_LINES = 12` with a **Show N more lines / Collapse**
  toggle. Previously dumped all rows (140+ for a large edit) to the DOM.

### Refactored
- Extracted `flattenHistoricalEvents` (event → TimelineEntry) and the
  `recallUp` / `recallDown` / `pushAfterSend` state machine into pure
  modules (`flatten.ts`, `recall.ts`) so they're unit-testable without a DOM.

---

## [1.7.27] — 2026-04-25

### Fixed
- **HiveChat sticky mount.** Switching agents or flipping Term↔Chat used
  to unmount HiveChat → `useEffect` cleanup killed the underlying
  `claude --print` subprocess → returning burned an API turn on resume
  and dropped any in-flight thinking. Now HiveChat stays mounted for the
  Terminal's lifetime and visibility is CSS-driven, matching xterm. One
  live `claude` per agent-with-chat-open — which is the whole point of
  Hive's multi-agent orchestration.

---

## [1.7.26] — 2026-04-25

### Added
- **Timeline cap (500 entries)** in HiveChat with a subtle "N earlier
  messages trimmed" hint. Prevents runaway React state on very long
  sessions; JSONL on disk remains the source of truth.
- **30-day retention** for `~/.hive/chat-logs/*.jsonl`. A sweep runs once
  on main-process startup; `~/.claude/projects` (Claude Code's own
  persistence) is never touched.

---

## [1.7.25] — 2026-04-25

### Added
- **↑/↓ recall** for sent user messages (bash-style). Stores a 100-entry
  ring; `↑` at the first line of the textarea (or while already browsing)
  steps back, `↓` walks forward with draft restoration past the newest.
  IME composition still short-circuits early.

### Changed
- **Softer user-message bubble.** Replaced the solid Dolly background
  (eye-burning) with a 1px Dolly border + `rgba(255,96,255,0.14)` tint +
  solid Dolly `❯` + Butter text — same design language as the input box.

---

## [1.7.24] — 2026-04-25

### Added
- **README: HiveChat section** announcing the new Crush-styled React chat
  mode with bullets covering streaming typewriter, colored ToolBlocks,
  Edit diff panel, syntax highlighting, clickable choices (numbered +
  letter), permission modal, real subscription %%, session resume,
  redaction, thinking spinner, IME-safe enter, 371 tests.

### Changed
- **Journey deck** (`docs/slides-hivechat-journey.html`) extended through
  v1.7.23: timeline adds v1.6.6 → v1.7.23; *What's shipped today* slide
  refreshed; *Next up* shuffled to reflect what shipped; Lesson #6 added
  (silent subprocess hang = missing handshake reply — the v1.7.18 lost
  afternoon). Roadmap marks HiveChat + real subscription %% done; adds
  session-scoped slash commands (`/remote-control`, `/clear`, `/compact`,
  `/model`) with the planned `--print → PTY --resume → --print` round-trip.

---

## [1.7.23] — 2026-04-24

### Changed
- **Thinking spinner** uses a `Charple → Dolly` scrolling gradient
  (`background-clip: text` + 400% `background-size` + keyframes), verified
  against Crush's `makeGradientRamp` source.

---

## [1.7.22] — 2026-04-24

### Changed
- **Sent user messages** rendered with a solid Dolly background + Butter
  text so they're visually distinct from the input box. *(Reverted to a
  softer alpha-tinted version in v1.7.25 after user feedback.)*

---

## [1.7.21] — 2026-04-24

### Fixed
- **Permission schema** recovered from a captured log — allow =
  `{updatedInput: <record>}`, deny = `{behavior: 'deny', message: <string>}`.
  Fixed the silent subprocess hang introduced in v1.7.18.
- **Letter choices** (`A）不修` / `B）先修`) now rendered as clickable
  buttons. Regex upgraded to match `(\d+|[A-Za-z])` with ascii or fullwidth
  parens, allowing zero space between marker and CJK label.
- **File-tool colors** aligned to preview: Read / Edit / Grep = Julep
  green (file-touching), Bash = Malibu blue (commands).

---

## [1.7.20] — 2026-04-24

### Added
- **Thinking spinner** — `✳ Blanching… 3s` (verb cycles through a list,
  glyph rotates, elapsed counter ticks) shown at the bottom of the
  timeline from `message_start` until the first `text_delta` or
  `message_stop`.

---

## [1.7.19] — 2026-04-24

### Added
- **MCP tool cards** — `mcp__<server>__<function>` split into a
  color-coded server pill + function name row.
- **Result summary card** at the end of each assistant turn — cost,
  duration, tokens, cache reads.
- **Allow & remember** — permission modal writes `ToolName(pattern)` into
  `~/.claude/settings.json` `permissions.allow` so future calls bypass.
- **Slash-command pill** — `/compact`, `/clear`, etc. render as rounded
  Dolly pills with a `⚡` glyph.

---

## [1.7.18] — 2026-04-24

### Fixed
- **Permission modal handshake** re-wired — `--permission-prompt-tool stdio`
  requires a `control_response` reply on stdin for every `control_request`
  on stdout. Earlier attempts hung the subprocess. (Full schema fix
  landed in v1.7.21.)

---

## [1.7.16] — 2026-04-23

### Fixed
- Rebase output now flows into the timeline as `system` entries rather
  than a pinned box above the input.

---

## [1.7.15] — 2026-04-23

### Added / Changed
- **FilesPanel footer** respects `streamingMode` (redacts path when on).
- **Shared `shortenPath`** utility unified across Chat, Terminal, and
  FilesPanel.

---

## [1.7.14] — 2026-04-23

### Added
- Initial **vitest coverage** for hive-chat pure helpers.

---

## [1.7.13] — 2026-04-23

### Changed
- Shorter % bars in the usage row; dropped "in 5h block" text so the
  streaming-mode toggle fits on one line.

---

## [1.7.12] — 2026-04-23

### Changed
- Swapped Charple↔Dolly: input/user messages use Charple accents,
  tool-block borders use Dolly.

---

## [1.7.11] — 2026-04-23

### Fixed
- Cleaner status bars — dropped cost/burn from the top row; moved the
  "waiting for first message" placeholder above the input.

---

## [1.7.10] — 2026-04-23

### Fixed
- No more outer horizontal scrollbar on the whole timeline
  (`overflowY: auto, overflowX: hidden`; wide content scrolls inside its
  own block).
- Streaming-mode toggle always visible in the status bar.

---

## [1.7.9] — 2026-04-23

### Added
- **Streaming-mode toggle** in the status bar — flips between live
  token-by-token rendering and batch snapshots.
- **Dynamic user redaction** — screen-only masking of username +
  configurable secret patterns at runtime via `configureRedact`.
- **Secret masking** — Bearer tokens, Basic auth, common API-key shapes.

---

## [1.7.8] — 2026-04-23

### Added / Fixed
- **Screen redact** — `myname → m****e` et al. on-screen only (no JSONL
  mutation).
- Fixed a **duplicate-render bug** where the same assistant message
  appeared twice (stream_event vs cumulative assistant snapshot keying).

---

## [1.7.7] — 2026-04-22

### Added / Fixed
- **Syntax highlighting** in Read / Bash results via
  `prism-react-renderer` with a Crush theme.
- **Typing perf** — `React.memo` + `useMemo` + `useCallback` across the
  timeline; typing latency on large sessions drops from 1s+ to
  near-instant.
- **Smart collapse** on long tool results (12-line default).

---

## [1.7.6] — 2026-04-22

### Added
- **Error tool result** rendering with Sriracha text + background tint.
- **Read panel with line numbers** — gutter-aligned, clickable file path
  opens in Finder.

---

## [1.7.5] — 2026-04-22

### Added
- **Session resume replays JSONL history** when `continueSession` is on.
  Reads `~/.claude/projects/<cwd-slug>/<sid>.jsonl` and emits past
  user/assistant turns as `_historical: true` events.
- **Tilde path display** for paths under `$HOME`.

---

## [1.7.4] — 2026-04-22

### Added
- **Crush-styled markdown tables** rendered by `react-markdown` +
  `remark-gfm`.
- **Diff gutter line numbers** in the Edit diff panel.

---

## [1.7.3] — 2026-04-22

### Fixed
- **IME-safe Enter** — no accidental send mid-pinyin composition.
- **Event-driven usage refresh** — `/usage` scrape fires on `message_stop`
  (30s debounce), not on an idle timer.

---

## [1.7.2] — 2026-04-22

### Added
- **Real subscription %%** via node-pty + `@xterm/headless` scraping of
  the interactive `/usage` TUI. Replaces previous guesses.

---

## [1.7.1] — 2026-04-22

### Added
- **ccusage-backed usage bar** (local, reads `~/.claude/sessions/`).
- `--include-hook-events` + `--permission-prompt-tool stdio` wired.

---

## [1.7.0] — 2026-04-22

### Added
- **Streaming typewriter** — hook into `content_block_delta` for live
  token-by-token text.
- **Edit diff panel** — before/after in Julep-plus / Sriracha-minus split.
- **Inline-code fix** — `react-markdown` v10 dropped the `inline` prop;
  detect via className / newline instead.

---

## [1.6.6] — 2026-04-21

### Added
- Usage % via `/usage`; Dolly progress bars; resume indicator in the
  empty-state hint.

---

## [1.6.5] — 2026-04-21

### Changed
- **Chat = default mode** (Term stays as fallback).
- Term startup flags mirrored onto Chat (`-c`, rebase-on-start).
- Hive-native deep-purple (`#0f0a1a`) background.

---

## [1.6.4] — 2026-04-21

### Added
- **Input box grows with content** (autosize textarea, 20–200px).
- **Markdown rendering** via `react-markdown`.
- **Clickable numbered choices** — `1. … 2. … 3. …` inline options.

---

## [1.6.3] — 2026-04-21

### Fixed
- **Dolly-bordered ToolBlock** wraps call + result together so the bar
  spans both.

---

## [1.6.2] — 2026-04-21

### Added
- **Status bars** — rate-limit row above input, model/usage row below.

---

## [1.6.1] — 2026-04-20

### Fixed
- **HiveChat schema accuracy** — dedup by `msg.id`, drop `thinking`
  blocks, auto-capture to `/tmp/claude-json.log` for iteration.

---

## [1.6.0] — 2026-04-20

### Added
- **HiveChat POC** — structured JSON chat mode backed by
  `claude --print --input-format stream-json --output-format stream-json
  --include-partial-messages`. Pretty-mode decoration path suspended
  (see `pretty-term/SUSPENDED.md`).

---

## [1.5.1] — 2026-04-18

### Added
- **Crush color remap** (24-bit SGR → Crush palette) + persistent
  user-input highlight in xterm decorations.

---

## [1.5.0] — 2026-04-18

### Changed
- **Pretty mode = xterm + Crush decoration overlays** (dead end; replaced
  by HiveChat in v1.6.0).

---

## [1.4.0] — 2026-04-17

### Changed
- **PrettyTerm rebuilt on `@xterm/headless`** + split into modules.

---

## [1.3.1] — 2026-04-17

### Fixed
- **CJK double-width** + **IME** for PrettyTerm.

---

## [1.3.0] — 2026-04-17

### Added
- **PrettyTerm** — Crush-styled React terminal with full interactivity
  (dead end; kept for reference).

---

## [1.2.0] — 2026-04-16

### Added
- **ClaudeTerm** — React-rendered terminal as xterm.js alternative
  (dead end).

---

## [0.8.0] — 2026-04-10

### Added
- Task-group gate reform + stuck detection for multi-agent orchestration.

---

[Unreleased]: https://github.com/nocodevit/hive/compare/v1.7.64...HEAD
[1.7.64]: https://github.com/nocodevit/hive/compare/v1.7.63...v1.7.64
[1.7.63]: https://github.com/nocodevit/hive/compare/v1.7.62...v1.7.63
[1.7.62]: https://github.com/nocodevit/hive/compare/v1.7.61...v1.7.62
[1.7.61]: https://github.com/nocodevit/hive/compare/v1.7.60...v1.7.61
[1.7.60]: https://github.com/nocodevit/hive/compare/v1.7.59...v1.7.60
[1.7.59]: https://github.com/nocodevit/hive/compare/v1.7.58...v1.7.59
[1.7.58]: https://github.com/nocodevit/hive/compare/v1.7.57...v1.7.58
[1.7.57]: https://github.com/nocodevit/hive/compare/v1.7.56...v1.7.57
[1.7.56]: https://github.com/nocodevit/hive/compare/v1.7.55...v1.7.56
[1.7.55]: https://github.com/nocodevit/hive/compare/v1.7.54...v1.7.55
[1.7.54]: https://github.com/nocodevit/hive/compare/v1.7.53...v1.7.54
[1.7.53]: https://github.com/nocodevit/hive/compare/v1.7.52...v1.7.53
[1.7.52]: https://github.com/nocodevit/hive/compare/v1.7.51...v1.7.52
[1.7.51]: https://github.com/nocodevit/hive/compare/v1.7.50...v1.7.51
[1.7.50]: https://github.com/nocodevit/hive/compare/v1.7.49...v1.7.50
[1.7.49]: https://github.com/nocodevit/hive/compare/v1.7.48...v1.7.49
[1.7.48]: https://github.com/nocodevit/hive/compare/v1.7.47...v1.7.48
[1.7.47]: https://github.com/nocodevit/hive/compare/v1.7.46...v1.7.47
[1.7.46]: https://github.com/nocodevit/hive/compare/v1.7.45...v1.7.46
[1.7.45]: https://github.com/nocodevit/hive/compare/v1.7.44...v1.7.45
[1.7.44]: https://github.com/nocodevit/hive/compare/v1.7.43...v1.7.44
[1.7.43]: https://github.com/nocodevit/hive/compare/v1.7.42...v1.7.43
[1.7.42]: https://github.com/nocodevit/hive/compare/v1.7.41...v1.7.42
[1.7.41]: https://github.com/nocodevit/hive/compare/v1.7.40...v1.7.41
[1.7.40]: https://github.com/nocodevit/hive/compare/v1.7.39...v1.7.40
[1.7.39]: https://github.com/nocodevit/hive/compare/v1.7.38...v1.7.39
[1.7.38]: https://github.com/nocodevit/hive/compare/v1.7.37...v1.7.38
[1.7.37]: https://github.com/nocodevit/hive/compare/v1.7.36...v1.7.37
[1.7.36]: https://github.com/nocodevit/hive/compare/v1.7.35...v1.7.36
[1.7.35]: https://github.com/nocodevit/hive/compare/v1.7.34...v1.7.35
[1.7.34]: https://github.com/nocodevit/hive/compare/v1.7.33...v1.7.34
[1.7.33]: https://github.com/nocodevit/hive/compare/v1.7.32...v1.7.33
[1.7.32]: https://github.com/nocodevit/hive/compare/v1.7.31...v1.7.32
[1.7.31]: https://github.com/nocodevit/hive/compare/v1.7.30...v1.7.31
[1.7.30]: https://github.com/nocodevit/hive/compare/v1.7.29...v1.7.30
[1.7.29]: https://github.com/nocodevit/hive/compare/v1.7.28...v1.7.29
[1.7.28]: https://github.com/nocodevit/hive/compare/v1.7.27...v1.7.28
[1.7.27]: https://github.com/nocodevit/hive/compare/v1.7.26...v1.7.27
[1.7.26]: https://github.com/nocodevit/hive/compare/v1.7.25...v1.7.26
[1.7.25]: https://github.com/nocodevit/hive/compare/v1.7.24...v1.7.25
[1.7.24]: https://github.com/nocodevit/hive/compare/v1.7.23...v1.7.24
[1.7.23]: https://github.com/nocodevit/hive/compare/v1.7.22...v1.7.23
[1.7.22]: https://github.com/nocodevit/hive/compare/v1.7.21...v1.7.22
[1.7.21]: https://github.com/nocodevit/hive/compare/v1.7.20...v1.7.21
[1.7.20]: https://github.com/nocodevit/hive/compare/v1.7.19...v1.7.20
[1.7.19]: https://github.com/nocodevit/hive/compare/v1.7.18...v1.7.19
[1.7.18]: https://github.com/nocodevit/hive/compare/v1.7.16...v1.7.18
[1.7.16]: https://github.com/nocodevit/hive/compare/v1.7.15...v1.7.16
[1.7.15]: https://github.com/nocodevit/hive/compare/v1.7.14...v1.7.15
[1.7.14]: https://github.com/nocodevit/hive/compare/v1.7.13...v1.7.14
[1.7.13]: https://github.com/nocodevit/hive/compare/v1.7.12...v1.7.13
[1.7.12]: https://github.com/nocodevit/hive/compare/v1.7.11...v1.7.12
[1.7.11]: https://github.com/nocodevit/hive/compare/v1.7.10...v1.7.11
[1.7.10]: https://github.com/nocodevit/hive/compare/v1.7.9...v1.7.10
[1.7.9]: https://github.com/nocodevit/hive/compare/v1.7.8...v1.7.9
[1.7.8]: https://github.com/nocodevit/hive/compare/v1.7.7...v1.7.8
[1.7.7]: https://github.com/nocodevit/hive/compare/v1.7.6...v1.7.7
[1.7.6]: https://github.com/nocodevit/hive/compare/v1.7.5...v1.7.6
[1.7.5]: https://github.com/nocodevit/hive/compare/v1.7.4...v1.7.5
[1.7.4]: https://github.com/nocodevit/hive/compare/v1.7.3...v1.7.4
[1.7.3]: https://github.com/nocodevit/hive/compare/v1.7.2...v1.7.3
[1.7.2]: https://github.com/nocodevit/hive/compare/v1.7.1...v1.7.2
[1.7.1]: https://github.com/nocodevit/hive/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/nocodevit/hive/compare/v1.6.6...v1.7.0
[1.6.6]: https://github.com/nocodevit/hive/compare/v1.6.5...v1.6.6
[1.6.5]: https://github.com/nocodevit/hive/compare/v1.6.4...v1.6.5
[1.6.4]: https://github.com/nocodevit/hive/compare/v1.6.3...v1.6.4
[1.6.3]: https://github.com/nocodevit/hive/compare/v1.6.2...v1.6.3
[1.6.2]: https://github.com/nocodevit/hive/compare/v1.6.1...v1.6.2
[1.6.1]: https://github.com/nocodevit/hive/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/nocodevit/hive/compare/v1.5.1...v1.6.0
[1.5.1]: https://github.com/nocodevit/hive/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/nocodevit/hive/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/nocodevit/hive/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/nocodevit/hive/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/nocodevit/hive/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/nocodevit/hive/compare/v0.8.0...v1.2.0
[0.8.0]: https://github.com/nocodevit/hive/releases/tag/v0.8.0
