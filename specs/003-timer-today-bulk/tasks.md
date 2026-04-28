# Tasks: Timer Control, Today Tasks & Bulk Operations

**Input**: Design documents from `specs/003-timer-today-bulk/`
**Prerequisites**: plan.md ✅, spec.md ✅, data-model.md ✅, contracts/commands.md ✅

**Organization**: Tasks grouped by user story for independent implementation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story (US1, US2, US3)

## Path Conventions

- MCP server: `src/ipc/types.ts`, `src/tools/tasks.ts`
- SP plugin: `plugin/plugin.js`
- Tests: `tests/unit/tools/tasks.test.ts`

---

## Phase 1: Foundational (Blocking Prerequisites)

- [ ] T001 Extend `src/ipc/types.ts`: add `plannedForToday?` to `TaskFilters`; add `updates?` array type to `Command`

**Checkpoint**: Type contracts in place — all user story tasks can now start.

---

## Phase 2: User Story 1 — Timer Control (Priority: P1) 🎯 MVP

**Goal**: Start/stop the time tracker on a task via MCP.

**Independent Test**: Start timer on a task, verify `get_current_task` returns it. Stop timer, verify null.

- [ ] T002 [P] [US1] Add `startTask` command handler in `plugin/plugin.js`: read task via `getTasks()`, validate not done, dispatch `[Task] Set Current Task` NgRx action with full task object
- [ ] T003 [P] [US1] Add `stopTask` command handler in `plugin/plugin.js`: dispatch `[Task] Unset Current Task` NgRx action (idempotent)
- [ ] T004 [P] [US1] Add `start_task` tool in `src/tools/tasks.ts`: input `task_id`; sends `startTask` command
- [ ] T005 [P] [US1] Add `stop_task` tool in `src/tools/tasks.ts`: no inputs; sends `stopTask` command
- [ ] T006 [P] [US1] Write unit tests for US1 timer operations in `tests/unit/tools/tasks.test.ts`: cover start (success, already tracking, done task error), stop (success, idempotent)

**Checkpoint**: Timer control functional. `start_task` and `stop_task` independently testable.

---

## Phase 3: User Story 2 — Today Tasks (Priority: P2)

**Goal**: `get_tasks` supports `planned_for_today` filter.

**Independent Test**: Call `get_tasks` with `planned_for_today=true` — verify only tasks with today's `plannedAt` are returned.

- [ ] T007 [US2] Add `planned_for_today` input param to `get_tasks` tool in `src/tools/tasks.ts` and implement filter logic: compute local day boundaries, match `task.plannedAt >= startOfToday && task.plannedAt < startOfTomorrow`
- [ ] T008 [P] [US2] Write unit tests for US2 today filter in `tests/unit/tools/tasks.test.ts`: cover today (included), yesterday (excluded), null (excluded), combined with other filters

**Checkpoint**: Today filter functional. Single-call "what should I work on?" query works.

---

## Phase 4: User Story 3 — Bulk Operations (Priority: P3)

**Goal**: Complete, update, and delete multiple tasks in a single IPC round-trip.

**Independent Test**: Call `bulk_complete_tasks` with 3 IDs (one invalid) — verify 2 succeed, 1 error in results.

- [ ] T009 [P] [US3] Add `bulkCompleteTasks` command handler in `plugin/plugin.js`: iterate `taskIds`, call `updateTask(id, { isDone: true, doneOn: Date.now() })` for each, collect per-item results
- [ ] T010 [P] [US3] Add `bulkUpdateTasks` command handler in `plugin/plugin.js`: iterate `updates`, call `updateTask(item.taskId, item.data)` for each, collect per-item results
- [ ] T011 [P] [US3] Add `bulkDeleteTasks` command handler in `plugin/plugin.js`: read all tasks, iterate `taskIds`, dispatch `[Task] Delete Task` NgRx action for each, collect per-item results
- [ ] T012 [P] [US3] Add `bulk_complete_tasks` tool in `src/tools/tasks.ts`: input `task_ids` (array); sends `bulkCompleteTasks` command; returns results array
- [ ] T013 [P] [US3] Add `bulk_update_tasks` tool in `src/tools/tasks.ts`: input `updates` (array of `{task_id, ...fields}`); maps to `bulkUpdateTasks` command
- [ ] T014 [P] [US3] Add `bulk_delete_tasks` tool in `src/tools/tasks.ts`: input `task_ids` (array); sends `bulkDeleteTasks` command; returns results array
- [ ] T015 [P] [US3] Write unit tests for US3 bulk operations in `tests/unit/tools/tasks.test.ts`: cover all-success, partial-failure, empty array, invalid IDs

**Checkpoint**: All bulk operations functional with partial-success semantics.

---

## Phase 5: Polish & Integration

- [ ] T016 Manual integration test against SP >= 14.0.0: verify `dispatchAction` for timer start/stop works correctly and timer state is reflected in `get_current_task`
- [ ] T017 Manual integration test: verify `dispatchAction` for delete removes task and subtasks
- [ ] T018 Update README.md: add new tools to the Available Tools table

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1**: No dependencies — start immediately
- **Phases 2–4**: All depend on Phase 1 completion; can proceed in parallel
- **Phase 5**: Depends on Phases 2–4 complete

### Within Each User Story

- Plugin handler tasks [P] and MCP tool tasks [P] can run in parallel (different files)
- Test tasks [P] can run in parallel with implementation

---

## Parallel Opportunities

### Phase 2 (US1) — after T001

```
Parallel group A (plugin/plugin.js):
  T002 startTask handler
  T003 stopTask handler

Parallel group B (src/tools/tasks.ts):
  T004 start_task tool
  T005 stop_task tool

Parallel group C (tests):
  T006 US1 unit tests
```

### Phase 3 (US2) — after T001

```
T007 filter implementation (sequential — same file section)
T008 US2 unit tests (parallel with T007)
```

### Phase 4 (US3) — after T001

```
Parallel group A (plugin/plugin.js):
  T009 bulkCompleteTasks handler
  T010 bulkUpdateTasks handler
  T011 bulkDeleteTasks handler

Parallel group B (src/tools/tasks.ts):
  T012 bulk_complete_tasks tool
  T013 bulk_update_tasks tool
  T014 bulk_delete_tasks tool

Parallel group C (tests):
  T015 US3 unit tests
```

---

## Implementation Strategy

### MVP First (Timer Control Only)

1. T001 → Foundation
2. T002–T006 (US1) → Timer control live
3. **VALIDATE**: `start_task` / `stop_task` working with real SP

### Incremental Delivery

1. T001 → Foundation ready
2. T002–T006 (US1) → Timer control (MVP)
3. T007–T008 (US2) → Today filter
4. T009–T015 (US3) → Bulk operations
5. T016–T018 → Integration verified, docs updated

---

## Notes

- `dispatchAction` does not return a promise — fire-and-forget. Plugin should verify state after dispatch if needed.
- NgRx action `[Task] Set Current Task` requires the full task object, not just the ID. Plugin must read the task first.
- NgRx action `[Task] Delete Task` also requires the full task object.
- Bulk operations are processed sequentially within the plugin to avoid race conditions on shared state.
- Empty array input to bulk operations returns `{ results: [] }` — not an error.
