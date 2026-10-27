## 1. Plugin

- [ ] 1.1 Add `moveTasksBacklog` case to plugin/plugin.js: load tasks and projects, validate whole batch (exists, top-level, has project, project exists, `isEnableBacklog` when destination is `backlog`, task in one of the two lists), re-read projects, write `taskIds`/`backlogTaskIds` once per project via `PluginAPI.updateProject`; return `{ moved, unchanged }`
- [ ] 1.2 Add backlog guard to the `reorderTasks` case (`contextType: 'project'`): reject IDs found in the project's `backlogTaskIds`
- [ ] 1.3 Bump `PLUGIN_VERSION` in plugin/plugin.js and `version` in plugin/manifest.json to 1.8.0

## 2. MCP server

- [ ] 2.1 Add `moveTasksBacklogSchema` (`task_ids` non-empty array, max 100, `destination` enum `backlog|regular`) and `move_tasks_backlog` tool in src/tools/tasks.ts sending `moveTasksBacklog`
- [ ] 2.2 Update `reorder_tasks` description to say backlog tasks are rejected and to use `move_tasks_backlog`
- [ ] 2.3 Mention the new tool in README tool list if tools are listed there

## 3. Tests

- [ ] 3.1 Add unit tests in tests/unit/tools/tasks.test.ts: command payload for both destinations, empty `task_ids` error, plugin error surfaced, result passthrough
- [ ] 3.2 Add plugin-logic tests if the existing plugin test setup allows (backlog guard, disabled backlog, idempotent no-op)
- [ ] 3.3 Run `npm run typecheck`, `npm run lint`, `npm test`

## 4. Verification

- [ ] 4.1 Manually verify against a running Super Productivity: move to and from backlog, check task shows in the right list and in exactly one
- [ ] 4.2 Run `openspec validate add-task-backlog-tools --strict` and fix any reported issues
