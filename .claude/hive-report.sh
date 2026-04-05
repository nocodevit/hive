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
AGENT="agent-1775389695002"
PORT=17796

case "$ACTION" in
  start)
    curl -s -X POST http://127.0.0.1:$PORT/report -H "Content-Type: application/json" \
      -d "{\"agentId\":\"$AGENT\",\"type\":\"task_start\",\"title\":\"$MSG\"}" > /dev/null 2>&1
    ;;
  done)
    curl -s -X POST http://127.0.0.1:$PORT/report -H "Content-Type: application/json" \
      -d "{\"agentId\":\"$AGENT\",\"type\":\"task_done\",\"summary\":\"$MSG\"}" > /dev/null 2>&1
    ;;
  todo)
    curl -s -X POST http://127.0.0.1:$PORT/report -H "Content-Type: application/json" \
      -d "{\"agentId\":\"$AGENT\",\"type\":\"todo\",$(echo $MSG | sed 's/^{//')}" > /dev/null 2>&1
    ;;
  task-create)
    # Inject agentId so server can resolve projectId from task group
    PAYLOAD=$(echo "$MSG" | sed "s/^{/{\"agentId\":\"$AGENT\",/")
    curl -s -X POST http://127.0.0.1:$PORT/task-create -H "Content-Type: application/json" \
      -d "$PAYLOAD"
    ;;
  task-assign)
    TASK_ID="$2"
    TARGET="$3"
    curl -s -X POST http://127.0.0.1:$PORT/task-assign -H "Content-Type: application/json" \
      -d "{\"projectId\":\"\",\"taskId\":\"$TASK_ID\",\"agentId\":\"$TARGET\"}" > /dev/null 2>&1
    ;;
  task-done)
    TASK_ID="$2"
    SUMMARY="$3"
    curl -s -X POST http://127.0.0.1:$PORT/task-done -H "Content-Type: application/json" \
      -d "{\"agentId\":\"$AGENT\",\"taskId\":\"$TASK_ID\",\"summary\":\"$SUMMARY\"}" > /dev/null 2>&1
    ;;
  task-blocked)
    TASK_ID="$2"
    REASON="$3"
    curl -s -X POST http://127.0.0.1:$PORT/task-blocked -H "Content-Type: application/json" \
      -d "{\"agentId\":\"$AGENT\",\"taskId\":\"$TASK_ID\",\"reason\":\"$REASON\"}" > /dev/null 2>&1
    ;;
  task-status)
    curl -s -X POST http://127.0.0.1:$PORT/task-status -H "Content-Type: application/json" \
      -d "{\"agentId\":\"$AGENT\"}"
    ;;
  ready)
    curl -s -X POST http://127.0.0.1:$PORT/ready -H "Content-Type: application/json" \
      -d "{\"agentId\":\"$AGENT\"}" > /dev/null 2>&1
    ;;
  report-human)
    curl -s -X POST http://127.0.0.1:$PORT/report-human -H "Content-Type: application/json" \
      -d "{\"agentId\":\"$AGENT\",\"message\":\"$MSG\"}" > /dev/null 2>&1
    ;;
  batch-propose)
    # Inject agentId into the JSON payload
    PAYLOAD=$(echo "$MSG" | sed "s/^{/{\"agentId\":\"$AGENT\",/")
    curl -s -X POST http://127.0.0.1:$PORT/batch-propose -H "Content-Type: application/json" \
      -d "$PAYLOAD" > /dev/null 2>&1
    ;;
esac
