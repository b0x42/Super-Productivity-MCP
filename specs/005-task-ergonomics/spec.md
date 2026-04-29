# Feature Specification: Task Ergonomics

**Feature Branch**: `005-task-ergonomics`
**Created**: 2026-04-29
**Status**: Draft
**Input**: Three improvements to task operations — response shaping for token efficiency, delete task for CRUD completeness, and batch subtask creation for planning workflows.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Field Selection on get_tasks (Priority: P1)

An AI agent listing tasks for triage only needs `id`, `title`, and `dueDay` — not full task objects with timeSpentOnDay, subTaskIds, and other internal fields. A `fields` parameter lets the agent request only what it needs.

**Why this priority**: Highest token-cost impact. A user with 200 tasks currently gets ~100KB of JSON. Field selection cuts this 3-5x.

**Independent Test**: Call `get_tasks` with `fields: ["id", "title", "dueDay"]`, verify response contains only those fields per task.

**Acceptance Scenarios**:

1. **Given** tasks exist, **When** `get_tasks` is called with `fields: ["id", "title"]`, **Then** each task in the response contains only `id` and `title`
2. **Given** tasks exist, **When** `get_tasks` is called without `fields`, **Then** the full task object is returned (backward compatible)
3. **Given** `fields` includes an unknown field name, **When** called, **Then** that field is silently omitted (no error)
4. **Given** `fields` is an empty array, **When** called, **Then** the full task object is returned (treat empty as "all")

---

### User Story 2 - Delete Task (Priority: P2)

An AI agent needs to remove a mistaken duplicate or junk task. Currently there's no way to delete — only complete or archive.

**Why this priority**: Basic CRUD completeness. Without delete, the AI must tell users "I can't remove that."

**Independent Test**: Create a task, call `delete_task` with its ID, verify `get_tasks` no longer returns it.

**Acceptance Scenarios**:

1. **Given** a task exists, **When** `delete_task` is called with its ID, **Then** the task is permanently removed
2. **Given** a parent task with subtasks, **When** `delete_task` is called on the parent, **Then** the parent and all subtasks are removed (SP native behaviour)
3. **Given** an invalid task ID, **When** `delete_task` is called, **Then** an error is returned
4. **Given** a subtask ID, **When** `delete_task` is called, **Then** only that subtask is removed (parent remains)

---

### User Story 3 - Create Task with Subtasks (Priority: P3)

An AI agent breaks down a goal into a parent task + subtasks in one operation, avoiding N+1 sequential IPC calls.

**Why this priority**: The most common AI planning pattern. Reduces latency from ~6s (3 subtasks × 2s each) to ~2s (single IPC call).

**Independent Test**: Call `create_task_with_subtasks` with a parent title and 3 subtask titles, verify all 4 tasks exist with correct parent-child relationships.

**Acceptance Scenarios**:

1. **Given** a parent title and 3 subtask titles, **When** `create_task_with_subtasks` is called, **Then** a parent task is created with 3 subtasks linked to it
2. **Given** a project_id is specified, **When** called, **Then** the parent is assigned to that project (subtasks inherit)
3. **Given** tag_ids are specified, **When** called, **Then** the parent gets those tags (subtasks don't get tags — SP behaviour)
4. **Given** an empty subtasks array, **When** called, **Then** only the parent task is created (degrades gracefully)
5. **Given** the operation, **When** it completes, **Then** the response includes the parent ID and all subtask IDs

---

### Edge Cases

- What if `fields` contains `"id"` only? (Valid — returns `[{ id: "..." }]`)
- What if `delete_task` is called on an already-deleted task? (Error: "Task not found")
- What if `create_task_with_subtasks` has 20 subtasks? (Allowed — no artificial limit beyond SP's own)
- What if a subtask title contains SP short syntax? (Parsed normally — same as `create_task` with `parent_id`)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `get_tasks` MUST accept an optional `fields` parameter (array of strings)
- **FR-002**: When `fields` is provided and non-empty, each task in the response MUST contain only the specified fields
- **FR-003**: When `fields` is omitted or empty, the full task object MUST be returned (backward compatible)
- **FR-004**: Unknown field names in `fields` MUST be silently ignored
- **FR-005**: System MUST provide a `delete_task` tool that permanently removes a task by ID
- **FR-006**: `delete_task` on a parent task MUST also remove all its subtasks
- **FR-007**: `delete_task` on a non-existent task MUST return an error
- **FR-008**: System MUST provide a `create_task_with_subtasks` tool that creates a parent + N children in one IPC round-trip
- **FR-009**: `create_task_with_subtasks` MUST return `{ parentId, subtaskIds: [...] }`
- **FR-010**: `create_task_with_subtasks` MUST support `project_id` and `tag_ids` on the parent

### Key Entities

- **Task** (unchanged): Existing task model
- **Field Selection**: Array of valid task field names used to shape the response
- **Subtask Batch**: `{ title, notes? }[]` — minimal subtask definitions

### Valid Field Names for FR-001

`id`, `title`, `isDone`, `projectId`, `parentId`, `tagIds`, `dueDay`, `dueWithTime`, `plannedAt`, `timeEstimate`, `timeSpent`, `notes`, `subTaskIds`, `doneOn`

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `get_tasks` with `fields: ["id", "title"]` returns ≤20% of the payload size compared to no field selection (for a user with 50+ tasks)
- **SC-002**: An agent can delete a task without manual SP interaction
- **SC-003**: Creating a parent + 3 subtasks completes in a single IPC round-trip (~2s) instead of 4 sequential calls (~8s)
- **SC-004**: All new operations return explicit success or error responses

## Assumptions

- Field selection is applied server-side after filtering (no plugin changes needed)
- `delete_task` uses `PluginAPI.deleteTask(taskId)` if available, or `dispatchAction` with `[Task] Delete Task` NgRx action
- `create_task_with_subtasks` is handled as a new plugin action that calls `addTask` for parent then children sequentially within the plugin (single IPC round-trip from server perspective)
- SP's `addTask` returns the created task ID, which the plugin uses to set `parentId` on subtasks
- No protocol version bump needed — all additions are additive
