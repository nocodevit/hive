# Multi-Agent Integration Test — All Runs Summary

## Run 1-4: Test Script Bugs
| Run | Result | Bug | Fix |
|---|---|---|---|
| 1 | ❌ 0/7 | app.firstWindow() timeout — port conflict 17710 | Use port 17796 |
| 2 | ❌ 2/7 | selectOption regex not supported | Exact label strings |
| 3 | ❌ 2/7 | Checkbox strict mode, 2 matches | getByRole().first() |
| 4 | ❌ 3/7 | Task Group tab not visible after agent terminal | goToTaskGroupTab() helper |

## Run 5-9: Manager Can't Call batch-propose
| Run | Result | Bug | Fix |
|---|---|---|---|
| 5 | ✅ 7/7 FALSE | hive-report.sh missing all new commands (batch-propose etc) | writeAgentDefinition uses generateReportScript() |
| 6 | ✅ 7/7 FALSE | 15s wait too short for Manager | 3 min polling loop |
| 7 | ✅ 7/7 FALSE | Manager can't find todo.md (relative path, wrong cwd) | Absolute path |
| 8 | ✅ 7/7 FALSE | Manager stuck on Y/n confirmation | Send Y at 90s |
| 9 | ✅ 7/7 FALSE | Y sent at 61s, Manager still rendering table | Delay to 120s |

## Run 10: Manager Pipeline Works (First Time)
| Run | Result | Key Finding |
|---|---|---|
| 10 | ✅ 7/7 FALSE | Manager successfully called batch-propose + report-human! But selected wrong workers (Ivan, Jeeva instead of [TEST] Workers) |

## Run 11-15: Proposal Card Never Appears
| Run | Result | Bug | Fix |
|---|---|---|---|
| 11 | ✅ 7/7 FALSE | Manager didn't finish (soul addendum too long?) | — |
| 12 | ✅ 7/7 FALSE | Manager parsed 3 tasks correctly, Y/n at 99s | — |
| 13 | ✅ 7/7 FALSE | Skill auto-launched interactive menu | Remove skill auto-start from soul |
| 14 | ✅ 7/7 FALSE | Same — residual agent definitions | Clean [TEST] definitions in beforeAll |
| 15 | ✅ 7/7 FALSE | Same — old definitions still on disk | Check content.includes('[TEST]') before delete |

## Run 16-19: Proposal Card Root Cause Found
| Run | Result | Bug | Fix |
|---|---|---|---|
| 16 | ✅ 7/7 FALSE | batch-propose endpoint didn't update taskGroup.status | Set status='batch_proposed' in endpoint + React state |
| 17 | ✅ 7/7 FALSE | Still 0 tasks — timing | Increase wait |
| 18 | ❌ 1/4 | Manager reached batch-propose at 565s (9.4 min) but 8 min timeout | Increase to 15 min |
| 19 | ❌ 1/4 | batch-propose JSON missing agentId | hive-report.sh injects agentId via sed |

## Run 20-23: Approve Works, Tasks Not Created
| Run | Result | Bug | Fix |
|---|---|---|---|
| 20 | 4/4 soft | Approve clicked! But Manager waiting for terminal Y, not [HIVE:HUMAN] | Approve sends both [HIVE:HUMAN] + Y via PTY |
| 21 | 4/4 soft | Tasks created but wrong projectId (test-multi-agent-tasks/) | Soul includes projectId |
| 22 | 4/4 soft | task-create endpoint doesn't resolve projectId from task group | task-create auto-injects agentId, endpoint resolves projectId |
| 23 | 4/4 soft | 0/0 tasks in polling but files exist | Test cut to workers before Manager finished |

## Run 24-26: Data.json Race Condition
| Run | Result | Bug | Fix |
|---|---|---|---|
| 24 | ❌ 1/4 | Manager created tasks + assigned! But 0 tasks in polling | Real Hive app overwrites data.json (taskGroups: []) |
| 25 | ❌ 1/4 | Debug: findTaskGroupForAgent always null | Confirmed: real app overwriting |
| 26 | ❌ 1/4 | Same | — |

## Run 27-30: Isolated Data Dir
| Run | Result | Bug | Fix |
|---|---|---|---|
| 27 | 4/4 soft | ✅ 2 tasks created at 10s! Isolated dir works. Workers 0/2 done. | task-assign before Workers started |
| 28 | 4/4 soft | 4 tasks created, 2 assigned. Workers 0/4. | Test broke out too early (taskCount>0) |
| 29 | 4/4 soft | 2/4 assigned at 10s. Workers 0/4. | Workers started after assign → PTY missed |
| 30 | 4/4 soft | Same — Workers started first but still 0/4 | Manager used title not task ID for assign |

## Run 31-32: Endpoints Use Wrong Data Dir
| Run | Result | Bug | Fix |
|---|---|---|---|
| 31 | 4/4 soft | Dispatcher log shows only batch-propose, no task-create | Endpoints used app.getPath('home') not DATA_DIR |
| 32 | 4/4 soft | ✅ task-assign PTY: true! Gate ❌ npm build fails (no package.json) | tasks.ts uses DATA_DIR; gate skips build if no package.json |

## Run 33-34: 3 Tasks FULLY WORKING 🎉
| Run | Result | Key Finding |
|---|---|---|
| 33 | 4/4 | **Worker-1 done at 93s, Worker-2 done at 252s. 2/2 tasks complete!** |
| 34 | 4/4 | **Stability: Worker-1 at 62s, Worker-2 at 159s. 2/2 done.** |

## Run 35-36: 10 Tasks — Multi-Assign Problem
| Run | Result | Bug | Fix |
|---|---|---|---|
| 35 | 4/4 soft | 8 assigned but 0 done — Manager assigned 4 per Worker | One-at-a-time dispatch + auto-assign |
| 36 | 4/4 soft | 2/8 assigned (1 per worker), Workers in_progress but 0 done | Gate fail loop (verify path in worktree) |

## Run 37-39: Path Issues + Soul Issues
| Run | Result | Bug | Fix |
|---|---|---|---|
| 37 | 4/4 soft | verify=echo ok, still 0/8 — not gate issue | Workers can't find test-multi-agent-tasks/ in worktree |
| 38 | 4/4 soft | Absolute paths in scope/verify | — |
| 39 | 4/4 soft | 2/8 assigned, 0/8 done 15 min | Workers complete file but never call task-done |

## Run 40: 3/8 Done — Auto-Assign Working! 🎉
| Run | Result | Key Finding |
|---|---|---|
| 40 | 4/4 soft | **3/8 done, 1 blocked, 4 pending.** Worker soul "immediate task-done" works. Auto-assign confirmed: Worker completes → gets next task. 15 min timeout not enough for all 8. |

---

## Bug Categories (28 total)

### Infrastructure Bugs (8)
- hive-report.sh missing commands (Run 5)
- Proposal card: endpoint didn't update status (Run 16)
- Proposal card: React state not synced (Run 16)
- batch-propose missing agentId (Run 19)
- task-create missing agentId (Run 22)
- Real Hive app overwrites data.json (Run 24-26)
- Endpoints use app.getPath('home') not DATA_DIR (Run 31)
- Gate runs npm build without package.json (Run 32)

### Soul/Instruction Bugs (6)
- Manager selected wrong workers (Run 10)
- Manager soul missing task-create step (Run 21)
- Manager soul missing projectId (Run 22)
- Manager used task title instead of ID for assign (Run 30)
- Manager assigned all tasks at once (Run 35)
- Worker soul: build/test/commit before task-done (Run 39)

### Test Script Bugs (10)
- Port conflict (Run 1)
- Selector issues x3 (Run 2-4)
- Timing issues x4 (Run 6-9)
- Approve timing (Run 20, 23, 28)
- Worker start order (Run 29)

### Design Bugs (4)
- Approve only sends [HIVE:HUMAN], Manager expects Y (Run 20)
- Relative paths in worktree context (Run 37-38)
- No one-at-a-time dispatch (Run 35)
- No auto-assign on completion (Run 35)
