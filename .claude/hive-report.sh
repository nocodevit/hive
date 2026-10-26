#!/bin/bash
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
AGENT="agent-1792587736772"
LOCK_FILE="/var/folders/pv/f5m189_n64ldtzhcz3z4m42m0000gn/T/hive-integration-test/port.lock"
if [ -f "$LOCK_FILE" ]; then
  PORT=$(head -1 "$LOCK_FILE")
else
  PORT=17796
fi

CMD="curl -s -w \"\n%{http_code}\" -X POST http://127.0.0.1:$PORT"
HDR="-H \"Content-Type: application/json\""

case "$ACTION" in
  # === Task Management ===
  task-create)
    PAYLOAD=$(echo "$MSG" | sed "s/^{/{\"agentId\":\"$AGENT\",/")
    $CMD/task-create $HDR -d "$PAYLOAD"
    ;;
  task-assign)
    TASK_ID="$2"; TARGET="$3"
    RESULT=$($CMD/task-assign $HDR -d "{\"projectId\":\"\",\"taskId\":\"$TASK_ID\",\"agentId\":\"$TARGET\"}")
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
      if git rev-parse --verify origin/staging >/dev/null 2>&1; then
        if ! git rebase origin/staging 2>/dev/null; then
          git rebase --abort 2>/dev/null
          if [ "$ATTEMPT" -lt 3 ]; then sleep 3; continue; fi
          echo "{\"ok\":false,\"error\":\"rebase conflict on staging after 3 attempts\",\"code\":\"REBASE_CONFLICT\"}"
          exit 1
        fi
      fi
      if git push --force-with-lease 2>/dev/null; then
        PUSH_OK=true; break
      fi
      if [ "$ATTEMPT" -lt 3 ]; then sleep 3; fi
    done
    if [ "$PUSH_OK" = false ]; then
      echo "{\"ok\":false,\"error\":\"git push failed after 3 attempts\",\"code\":\"PUSH_FAILED\"}"
      exit 1
    fi
    # Retry curl to dispatcher
    for ATTEMPT in 1 2 3; do
      RESULT=$($CMD/task-done $HDR -d "{\"agentId\":\"$AGENT\",\"taskId\":\"$TASK_ID\",\"summary\":\"$SUMMARY\"}")
      if [ -n "$RESULT" ]; then echo "$RESULT"; break; fi
      if [ "$ATTEMPT" -lt 3 ]; then sleep 2; fi
    done
    ;;
  task-blocked)
    TASK_ID="$2"; REASON="$3"
    $CMD/task-blocked $HDR -d "{\"agentId\":\"$AGENT\",\"taskId\":\"$TASK_ID\",\"reason\":\"$REASON\"}"
    ;;
  task-abandon)
    TASK_ID="$2"; REASON="$3"
    RESULT=$($CMD/task-abandon $HDR -d "{\"agentId\":\"$AGENT\",\"taskId\":\"$TASK_ID\",\"reason\":\"$REASON\"}")
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
    $CMD/task-status $HDR -d "{\"agentId\":\"$AGENT\"}"
    ;;

  # === Batch ===
  batch-propose)
    PAYLOAD=$(echo "$MSG" | sed "s/^{/{\"agentId\":\"$AGENT\",/")
    $CMD/batch-propose $HDR -d "$PAYLOAD"
    ;;

  # === Reporting ===
  start)
    $CMD/report $HDR -d "{\"agentId\":\"$AGENT\",\"type\":\"task_start\",\"title\":\"$MSG\"}"
    ;;
  done)
    $CMD/report $HDR -d "{\"agentId\":\"$AGENT\",\"type\":\"task_done\",\"summary\":\"$MSG\"}"
    ;;
  report-human)
    $CMD/report-human $HDR -d "{\"agentId\":\"$AGENT\",\"message\":\"$MSG\"}"
    ;;
  ready)
    $CMD/ready $HDR -d "{\"agentId\":\"$AGENT\"}"
    ;;

  # === Inbox (message queue) ===
  check-inbox)
    $CMD/check-inbox $HDR -d "{\"agentId\":\"$AGENT\"}"
    ;;

  *)
    echo "{\"ok\":false,\"error\":\"unknown command: $ACTION\"}"
    exit 1
    ;;
esac
