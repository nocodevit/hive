11:47:58 # Integration Test (3 tasks)

11:47:58 Isolated data dir: /var/folders/pv/f5m189_n64ldtzhcz3z4m42m0000gn/T/hive-integration-test
11:48:09 Baseline: 10 projects, 17 agents
11:48:13 Created [TEST] Manager
11:48:15 Created [TEST] Worker-1
11:48:18 Created [TEST] Worker-2
11:48:20 Created [TEST] QA
11:48:22 Created [TEST] Critic
11:48:25 Task group created
11:48:29 Manager terminal opened
11:48:32 Worker-1 terminal opened (before Manager instruction)
11:48:36 Worker-2 terminal opened (before Manager instruction)
11:48:37 Manager ID: agent-1775389692536
11:48:52 Sent direct instruction to manager
11:49:03 [10s] task-status: 0 tasks
11:49:16 [23s] task-status: 0 tasks
11:49:17 ✅ Clicked Approve — now waiting for Manager to create tasks
11:49:29 [post-approve 10s] tasks: 2
11:49:29 2 tasks exist after approve — checking assign...
11:49:29 ✅ 1/2 tasks assigned!
11:49:30 Proposal found: true
11:49:33 Worker-1 started
11:49:36 Worker-2 started
11:50:08 [30s] Workers: 0/2 done, 0 blocked
11:50:41 [62s] Workers: 1/2 done, 0 blocked
11:51:13 [96s] Workers: 1/2 done, 0 blocked
11:51:45 [127s] Workers: 1/2 done, 0 blocked
11:52:17 [159s] Workers: 2/2 done, 0 blocked
11:52:17 ✅ All tasks done or blocked
11:52:17 Workers complete: true
11:52:20 QA started
11:53:24 Critic started
11:54:26 Test complete
11:54:26 
--- TEARDOWN ---
11:54:28 Dissolved task group
11:54:29 Deleted: [TEST] Manager
11:54:32 Deleted: [TEST] Worker-1
11:54:32 Deleted: [TEST] Worker-2
11:54:33 Deleted: [TEST] QA
11:54:34 Deleted: [TEST] Critic
11:54:34 Final: 10 projects, 17 agents
