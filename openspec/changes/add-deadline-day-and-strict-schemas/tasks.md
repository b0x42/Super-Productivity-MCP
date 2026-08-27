Each group below writes the failing test(s) first, then the implementation that makes them pass, per the project's TDD constitution (red → green).

## 1. deadline_day: update_task

- [x] 1.1 In `tests/unit/tools/tasks.test.ts`, add tests for `update_task`: `deadline_day` set to a date sets `data.deadlineDay`; `deadline_day` = `""` sets `data.deadlineDay` to `null`; omitting `deadline_day` leaves no `deadlineDay` key on `data`.
- [x] 1.2 In `src/tools/tasks.ts`, add `deadline_day: z.string().optional()` to `update_task`'s inputSchema; in the handler, `if (deadline_day !== undefined) data.deadlineDay = deadline_day || null;` (mirrors the existing `due_day` line).

## 2. deadline_day: create_task

- [x] 2.1 In `tests/unit/tools/tasks.test.ts`, add a test: `create_task` with `deadline_day` set includes `deadlineDay` equal to the given value in the created task's data.
- [x] 2.2 In `src/tools/tasks.ts`, add `deadline_day: z.string().optional()` to `create_task`'s inputSchema and map it in the handler to `data.deadlineDay`.

## 3. deadline_day: bulk_update_tasks (with partial-success)

- [x] 3.1 In `tests/unit/tools/tasks.test.ts`, add tests: multiple updates each with a different `deadline_day` map independently in the `mapped` array; and one update with an invalid `task_id` reports its own error while the other items' `deadline_day` updates still succeed.
- [x] 3.2 In `src/tools/tasks.ts`, add `deadline_day: z.string().optional()` to each item of `bulk_update_tasks`'s `updates` array schema and map it the same way as `due_day`.

## 4. Strict schemas: tasks.ts (top-level and nested)

- [x] 4.1 In `tests/unit/tools/tasks.test.ts`, add tests: an unrecognized top-level parameter on a representative tool (e.g. `update_task`) is rejected with an error naming that parameter; known-parameters-only calls still succeed; an unrecognized key nested inside one `bulk_update_tasks` `updates[]` item is rejected; an unrecognized key nested inside one `create_task` `subtasks[]` item (`tasks.ts:421`) is rejected.
- [x] 4.2 In `src/tools/tasks.ts`, wrap every `registerTool` call's inputSchema shape in `z.object({...}).strict()` (or equivalent) for all tools in this file — passing the resulting schema instance itself into `registerTool`'s `inputSchema`, not the raw shape — including the nested `updates[]` item schema in `bulk_update_tasks` and the nested `subtasks[]` item schema in `create_task`. Add a short comment at each `.strict()` site noting *why* it's required (issue #101's silent-drop bug), per the project's comment-the-why convention.

## 5. Strict schemas: projects.ts

- [x] 5.1 In `tests/unit/tools/projects.test.ts`, add tests: an unrecognized parameter on a representative tool is rejected naming that parameter; known-parameters-only calls still succeed.
- [x] 5.2 In `src/tools/projects.ts`, apply `.strict()` to every registered tool's inputSchema, passing the schema instance into `registerTool`.

## 6. Strict schemas: tags.ts

- [x] 6.1 In `tests/unit/tools/tags.test.ts`, add tests: unrecognized-parameter rejection (naming the parameter) and known-parameters-still-accepted, for a representative tool.
- [x] 6.2 In `src/tools/tags.ts`, apply `.strict()` to every registered tool's inputSchema, passing the schema instance into `registerTool`.

## 7. Strict schemas: habits.ts

- [x] 7.1 In `tests/unit/tools/habits.test.ts`, add tests: unrecognized-parameter rejection (naming the parameter) and known-parameters-still-accepted, for a representative tool, including one built from the exported `createHabitSchema`/`setHabitValueSchema`.
- [x] 7.2 In `src/tools/habits.ts`, apply `.strict()` to every registered tool's inputSchema, including the exported `createHabitSchema` and `setHabitValueSchema`. Fix the existing bug where `registerTool` was passed the bare raw shape instead of the exported schema for `create_habit`/`set_habit_value` — pass the actual schema instance so `.strict()` is enforced at runtime, not just in tests.

## 8. Strict schemas: notifications.ts

- [x] 8.1 In `tests/unit/tools/notifications.test.ts`, add tests: unrecognized-parameter rejection (naming the parameter) and known-parameters-still-accepted.
- [x] 8.2 In `src/tools/notifications.ts`, apply `.strict()` to every registered tool's inputSchema, passing the schema instance into `registerTool`.

## 9. Strict schemas: diagnostics.ts

- [ ] 9.1 In `tests/unit/tools/diagnostics.test.ts`, add tests: unrecognized-parameter rejection (naming the parameter) and known-parameters-still-accepted.
- [ ] 9.2 In `src/tools/diagnostics.ts`, apply `.strict()` to every registered tool's inputSchema, passing the schema instance into `registerTool`.

## 10. Verification

- [ ] 10.1 `npm run typecheck`
- [ ] 10.2 `npm run lint`
- [ ] 10.3 `npm test`
