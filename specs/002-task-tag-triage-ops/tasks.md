# Tasks: Task Tag & Triage Operations

**Input**: Design documents from `specs/002-task-tag-triage-ops/`
**Prerequisites**: plan.md ✅, spec.md ✅, data-model.md ✅, contracts/commands.md ✅

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

## Path Conventions

Per plan.md project structure:
- MCP server: `src/ipc/types.ts`, `src/tools/tasks.ts`
- SP plugin: `plugin/plugin.js`
- Tests: `tests/unit/tools/tasks.test.ts`

---

## Phase 1: Foundational (Blocking Prerequisites)

**Purpose**: Type system extensions that both the MCP server and plugin depend on. Must be complete before any user story work begins.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T001 Extend `src/ipc/types.ts`: add `parentsOnly?`, `overdue?`, `unscheduled?` to `TaskFilters`; add `taskIds?`, `contextId?`, `contextType?` to `Command`

**Checkpoint**: Type contracts in place — all user story tasks can now start in parallel.

---

## Phase 2: User Story 1 — Tag Management (Priority: P1) 🎯 MVP

**Goal**: Add/remove individual tags on tasks without replacing the full tag list; bulk-replace tags via `update_task`.

**Independent Test**: Given a task with tags [A, B], call `add_tag_to_task` with C → verify task has [A, B, C]. Call `remove_tag_from_task` with A → verify [B, C]. Call `remove_tag_from_task` with A again → verify error returned.

- [ ] T002 [P] [US1] Add `addTagToTask` command handler in `plugin/plugin.js`: read current `task.tagIds` via `getTasks()`, append tag if absent, call `updateTask({ tagIds: [...] })`; no-op if already present
- [ ] T003 [P] [US1] Add `removeTagFromTask` command handler in `plugin/plugin.js`: read current `task.tagIds`, filter out tag, call `updateTask({ tagIds: [...] })`; return error if tag not on task
- [ ] T004 [P] [US1] Add `add_tag_to_task` tool to `registerTaskTools` in `src/tools/tasks.ts`: inputs `task_id`, `tag_id`; sends `addTagToTask` command
- [ ] T005 [P] [US1] Add `remove_tag_from_task` tool to `registerTaskTools` in `src/tools/tasks.ts`: inputs `task_id`, `tag_id`; sends `removeTagFromTask` command
- [ ] T006 [P] [US1] Add `tag_ids` parameter to `update_task` tool in `src/tools/tasks.ts`: optional `z.array(z.string())`; when provided, include `tagIds` in the `data` payload sent to `updateTask` command
- [ ] T007 [P] [US1] Write unit tests for US1 tag operations in `tests/unit/tools/tasks.test.ts`: cover add (idempotent), remove (success + not-present error), bulk-replace via update_task

**Checkpoint**: Tag management fully functional. `add_tag_to_task`, `remove_tag_from_task`, and `update_task` with `tag_ids` all independently testable.

---

## Phase 3: User Story 2 — Triage Filters (Priority: P2)

**Goal**: `get_tasks` supports `parents_only`, `overdue`, and `unscheduled` filters combinable via AND logic.

**Independent Test**: Call `get_tasks` with `parents_only=true` — verify no tasks have a `parentId`. Call with `overdue=true` — verify all returned tasks have `dueDay < today`. Call with `parents_only=true, unscheduled=true` — verify intersection only. Call with `overdue=true, unscheduled=true` — verify empty result.

- [ ] T008 [US2] Add `parents_only`, `overdue`, `unscheduled` input params to `get_tasks` tool in `src/tools/tasks.ts` and pass them through to the filter object sent with the `getTasks` command
- [ ] T009 [US2] Implement `parentsOnly`, `overdue`, `unscheduled` post-fetch filter logic in the `get_tasks` handler in `src/tools/tasks.ts`: `parentsOnly` → exclude `task.parentId !== null`; `overdue` → `task.dueDay < todayLocalDate`; `unscheduled` → `!task.dueDay && !task.dueWithTime`; use `new Date().toISOString().slice(0, 10)` for local date comparison
- [ ] T010 [P] [US2] Write unit tests for US2 triage filter combinations in `tests/unit/tools/tasks.test.ts`: cover each filter individually + AND combinations + overdue+unscheduled empty case

**Checkpoint**: Triage filters functional. An agent can retrieve only triage-relevant tasks in a single `get_tasks` call.

---

## Phase 4: User Story 3 — Task Organisation (Priority: P3)

**Goal**: Move top-level tasks between projects, reorder tasks in a project/parent, and retrieve the currently time-tracked task.

**Independent Test**: Move a task to a new project — verify `task.projectId` changed. Reorder 3 tasks — verify SP displays them in the specified order. Start a timer on a task, call `get_current_task` — verify correct task returned. Stop timer, call again — verify null.

- [ ] T011 [P] [US3] Fix `persistDataSynced` two-arg bug and add `loadCurrentTask` handler in `plugin/plugin.js`: fix existing `persistDataSynced('currentTask', taskData)` → `persistDataSynced(JSON.stringify(taskData || null))`; add handler that calls `loadSyncedData()`, parses JSON, returns task or null
- [ ] T012 [P] [US3] Add `moveTaskToProject` command handler in `plugin/plugin.js`: validate `task.parentId === null` (error otherwise), call `updateTask({ projectId: newProjectId })`; validate project exists
- [ ] T013 [P] [US3] Add `reorderTasks` command handler in `plugin/plugin.js`: validate all `taskIds` belong to `contextId` (error on any foreign ID), call `PluginAPI.reorderTasks(taskIds, contextId, contextType)`
- [ ] T014 [P] [US3] Add `get_current_task` tool to `registerTaskTools` in `src/tools/tasks.ts`: no inputs; sends `loadCurrentTask` command; returns task object or null
- [ ] T015 [P] [US3] Add `move_task_to_project` tool to `registerTaskTools` in `src/tools/tasks.ts`: inputs `task_id`, `project_id`; sends `moveTaskToProject` command
- [ ] T016 [P] [US3] Add `reorder_tasks` tool to `registerTaskTools` in `src/tools/tasks.ts`: inputs `task_ids` (array), `context_id`, `context_type` (enum `project`/`parent`); sends `reorderTasks` command
- [ ] T017 [P] [US3] Write unit tests for US3 organisation operations in `tests/unit/tools/tasks.test.ts`: cover move (success + subtask error), reorder (success + foreign-id error), get_current_task (active + null)

**Checkpoint**: All 9 operations from spec.md SC-003 are implemented and independently testable.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Risk mitigation and verification noted in plan.md.

- [ ] T018 Manual integration test against SP >= 14.0.0: verify `move_task_to_project` causes task to appear under destination project and disappear from source (plan.md risk: SP reducer may not update `project.taskIds` automatically)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational (Phase 1)**: No dependencies — start immediately
- **User Stories (Phases 2–4)**: All depend on Phase 1 completion
  - US1, US2, US3 can proceed in parallel once Phase 1 is done
  - Or sequentially in priority order: US1 → US2 → US3
- **Polish (Phase 5)**: Depends on US3 (Phase 4) complete

### User Story Dependencies

- **US1 (P1)**: No dependency on US2 or US3
- **US2 (P2)**: No dependency on US1 or US3 (uses only `getTasks` extension)
- **US3 (P3)**: No dependency on US1 or US2 (uses separate plugin handlers + MCP tools)

### Within Each User Story

- Plugin handler tasks [P] and MCP tool tasks [P] can run in parallel (different files)
- Test tasks [P] can run in parallel with implementation tasks (write tests first or alongside)

---

## Parallel Opportunities

### Phase 1

```
T001 (single task — types.ts changes)
```

### Phase 2 (US1) — after T001

```
Parallel group A (plugin/plugin.js):
  T002 addTagToTask handler
  T003 removeTagFromTask handler

Parallel group B (src/tools/tasks.ts):
  T004 add_tag_to_task tool
  T005 remove_tag_from_task tool
  T006 tag_ids in update_task

Parallel group C (tests):
  T007 US1 unit tests
```

### Phase 3 (US2) — after T001

```
Sequential:
  T008 add filter params → T009 implement filter logic

Parallel with T008/T009:
  T010 US2 unit tests
```

### Phase 4 (US3) — after T001

```
Parallel group A (plugin/plugin.js):
  T011 fix persistDataSynced + loadCurrentTask handler
  T012 moveTaskToProject handler
  T013 reorderTasks handler

Parallel group B (src/tools/tasks.ts):
  T014 get_current_task tool
  T015 move_task_to_project tool
  T016 reorder_tasks tool

Parallel group C (tests):
  T017 US3 unit tests
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Foundational (T001)
2. Complete Phase 2: US1 tag management (T002–T007)
3. **STOP and VALIDATE**: `add_tag_to_task`, `remove_tag_from_task`, `update_task` with `tag_ids` all working
4. Ship or demo MVP

### Incremental Delivery

1. T001 → Foundation ready
2. T002–T007 (US1) → Tag management live (MVP)
3. T008–T010 (US2) → Triage filters live
4. T011–T017 (US3) → Full organisation ops live
5. T018 → Integration verified

---

## Notes

- [P] tasks touch different files — safe to parallelise
- Plugin-side (plugin.js) and MCP-side (tasks.ts) tasks for the same story are always [P]
- T011 includes a bug fix (`persistDataSynced`) that must land before `get_current_task` can work
- T018 is a manual verification step — the risk is that SP's reducer may silently ignore `projectId` updates from `updateTask`; if so, plan.md notes this as a blocker requiring investigation
