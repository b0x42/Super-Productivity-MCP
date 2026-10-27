# Tasks

Each group writes failing tests first, then the implementation (red → green).

## 1. Shared priority schema and update_task

- [x] 1.1 In `tests/unit/tools/tasks.test.ts`, add tests via captured handlers: `update_task` with `priority` 1/2/3 sets `data.priority`; `null` sets `data.priority` to `null`; omitted leaves no `priority` key; `4` and `"high"` fail validation naming `priority`; a `bulk_update_tasks` call with one item `priority` = `4` is rejected as a whole and sends no command; a `create_task_with_subtasks` call with one subtask `priority` = `4` is rejected as a whole. Verify they fail.
- [x] 1.2 In `src/tools/tasks.ts`, define one shared `priority` schema (`1|2|3|null`, optional, with a describe string) and add it to `update_task`; map `priority !== undefined` to `data.priority`. Verify 1.1 passes.

## 2. create_task

- [x] 2.1 In `tests/unit/tools/tasks.test.ts`, add tests: `create_task` with `priority` 3 sends `priority: 3` in the command data; without it, no `priority` key; `null` succeeds and is not sent as a follow-up. Verify they fail.
- [x] 2.2 In `src/tools/tasks.ts`, add the shared schema to `create_task` and map it into `data`. Verify 2.1 passes.
- [x] 2.3 In `tests/unit/plugin/executeCommand.test.ts`, add a test with a stubbed `PluginAPI`: `addTask` with `priority: 3` triggers a follow-up `updateTask(id, { priority: 3 })`; absent or `null` priority triggers none. Verify it fails, then in `plugin/plugin.js` `addTask` case add the follow-up and verify it passes.

## 3. bulk_update_tasks

- [x] 3.1 In `tests/unit/tools/tasks.test.ts`, add tests: items with different `priority` values (including `null`) map independently into each `updates[].data`; an item with an unknown `task_id` still reports its own error while the others succeed. Verify they fail.
- [x] 3.2 In `src/tools/tasks.ts`, add the shared schema to the `updates[]` item schema and map it like `deadline_day`. Verify 3.1 passes.

## 4. create_task_with_subtasks

- [x] 4.1 In `tests/unit/tools/tasks.test.ts`, add tests: parent `priority` 3 and subtask `priority` 1 reach the command data on the right entries; a subtask without `priority` carries none. Verify they fail.
- [x] 4.2 In `src/tools/tasks.ts`, add the shared schema to the parent and to `subtaskItemSchema`; pass through in the handler. Verify 4.1 passes.
- [x] 4.3 In `tests/unit/plugin/executeCommand.test.ts`, add a test with a stubbed `PluginAPI`: parent and subtask priorities each trigger a follow-up `updateTask`; entries without priority trigger none; when a follow-up `updateTask` rejects, the result is an error naming the failing task and the already-created ids, and no `deleteTask` is called. Verify it fails, then in `plugin/plugin.js` `createTaskWithSubtasks` add the follow-ups and verify it passes.

## 5. Verification and docs

- [x] 5.1 Update the README tool table to list `priority` on the four tools; verify the rows match the schemas.
- [x] 5.2 Run `make verify` (typecheck + lint + test) and verify it passes.
- [ ] 5.3 Manually verify against a live SP instance after `make`: set, change, clear priority via `update_task`; create with priority via `create_task` and `create_task_with_subtasks`; bulk update with one bad id. Resolve the design Open Question on `priority: null`.

## Workflow follow-up

- Archive the change after review and live verification.
