#!/usr/bin/env bash
#
# Empirically answer: when you run /remote-control and then close the PTY,
# does the mobile app keep working — or does closing the PTY kill the link?
#
# How it works:
#   Phase 1. Spawn `claude --session-id <fresh>` in YOUR terminal (=PTY).
#            You type /remote-control, pair your phone.
#   Phase 2. From the phone, send "hello from phone (PTY alive)".
#            The script is waiting on `claude` to exit — just watch stdout.
#            Does the assistant reply appear in your terminal? That's the
#            tell: yes → CLI is the executor. no → server owns it.
#   Phase 3. Close the PTY (Ctrl+D or /exit or Ctrl+C). The script resumes.
#   Phase 4. You send ANOTHER message from the phone. Wait ~30s.
#   Phase 5. Script diffs the JSONL: did the post-close turn land?
#
# Requirements: `claude` CLI logged in, phone with claude mobile app paired
# to your account.

set -euo pipefail

SID=$(uuidgen | tr '[:upper:]' '[:lower:]')
CWD_SLUG=$(pwd | sed 's|/|-|g; s|\.|-|g')
JSONL_DIR="$HOME/.claude/projects/$CWD_SLUG"
JSONL="$JSONL_DIR/$SID.jsonl"

cyan()   { printf '\033[36m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
red()    { printf '\033[31m%s\033[0m\n' "$*"; }
dim()    { printf '\033[2m%s\033[0m\n' "$*"; }
bar()    { printf '\033[35m%s\033[0m\n' "═══════════════════════════════════════════════════════════════════"; }

bar
cyan "Remote Control lifetime test"
bar
echo
echo "Question: does closing the PTY kill the /remote-control mobile link?"
echo
echo "Session id     : $SID"
echo "JSONL expected : $JSONL"
echo
yellow "Phase 1 — I'll spawn claude with a fresh session id. In that TUI:"
echo "  1. type   /remote-control    and pair your phone"
echo "  2. from the phone, send:     'hello from phone (PTY alive)'"
echo "  3. watch THIS terminal: does the assistant reply appear here?"
echo "     - YES → CLI is the executor. closing PTY will break mobile."
echo "     - NO  → server owns the session. closing PTY is safe."
echo "  4. send another phone msg:   'second (PTY alive)'    (for contrast)"
echo "  5. close the TUI: Ctrl+D  (or type /exit, or Ctrl+C)"
echo
read -rp "Hit ENTER when ready to launch claude..."
echo
bar

# Tee claude's output to a log file AND to the terminal, while passing stdin
# through. The easiest way to preserve PTY semantics + capture is the macOS
# `script` command.
LOG=$(mktemp /tmp/hive-rc-test.XXXXXX.log)
dim "PTY output also being captured to: $LOG"
echo

# `script -q -r` on macOS: -q silent, -r raw. First arg is output file.
# We spawn claude via script so the child still gets a real tty.
if ! command -v claude >/dev/null 2>&1; then
  red "claude CLI not found in PATH"
  exit 1
fi

script -q "$LOG" claude --session-id "$SID" || true

echo
bar
green "Phase 3 — PTY is now closed."
bar
echo
yellow "Phase 4 — from the phone, send ONE more message:"
echo "  'after close (PTY dead)'"
echo
echo "Wait ~30 seconds for the JSONL to flush, then hit ENTER."
read -rp ""

echo
bar
cyan "Phase 5 — inspecting JSONL"
bar
echo

if [[ ! -f "$JSONL" ]]; then
  red "JSONL not found at $JSONL"
  echo "Looking for alternative locations..."
  find "$HOME/.claude/projects" -name "*$SID*" 2>/dev/null | head -5
  exit 1
fi

echo "File: $JSONL"
LINES=$(wc -l < "$JSONL" | tr -d ' ')
echo "Total lines: $LINES"
echo

echo "=== role sequence (all turns) ==="
grep -oE '"role":"[^"]*"' "$JSONL" | nl | tail -20
echo

echo "=== last user message texts (up to 5) ==="
grep -oE '"role":"user"[^}]*"text":"[^"]{0,120}"' "$JSONL" 2>/dev/null | tail -5 | sed 's/^/  /'
echo

echo "=== last assistant message (truncated) ==="
grep -oE '"role":"assistant"[^}]*"text":"[^"]{0,120}"' "$JSONL" 2>/dev/null | tail -1 | sed 's/^/  /'
echo
bar

echo "Captured PTY log: $LOG"
echo
green "Interpretation:"
echo "  • If you see 'after close (PTY dead)' as a user turn AND an assistant"
echo "    reply after it → mobile survived PTY close. Server owns session."
echo "  • If the last user turn is 'second (PTY alive)' and nothing after →"
echo "    closing PTY killed the mobile link. Must keep PTY alive."
echo
dim "(This test is observational; re-run it 2-3 times for confidence.)"
