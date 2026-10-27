# Spec Delta

## Purpose

Task write tools let clients set and clear a task's priority (SP's `priority` field: 1 = Low, 2 = Medium, 3 = High), so an assistant can change priorities it can already read via `get_tasks`.

## ADDED Requirements

### Requirement: Priority value domain
Every tool that accepts `priority` SHALL accept only `1` (Low), `2` (Medium), `3` (High) or `null` (clear). Any other value SHALL fail validation, and no state is modified. Validation SHALL run on the whole call before any state is modified: an invalid `priority` in one `bulk_update_tasks` item or one subtask SHALL reject the entire call. Per-item partial success applies only to failures after validation, such as an unknown `task_id`.

#### Scenario: Out-of-range priority rejected
- **WHEN** a client calls a task write tool with `priority` = `4`
- **THEN** the call fails with a validation error naming `priority`, and no task is modified

#### Scenario: Non-numeric priority rejected
- **WHEN** a client calls a task write tool with `priority` = `"high"`
- **THEN** the call fails with a validation error naming `priority`, and no task is modified

#### Scenario: Invalid priority inside a batch item
- **WHEN** a client calls `bulk_update_tasks` with two items, one with `priority` = `4`
- **THEN** the whole call fails with a validation error naming `priority`, and neither task is modified

### Requirement: Set priority on task creation
`create_task` SHALL accept an optional `priority` and, when it is `1`, `2` or `3`, create the task with that priority. Omitting it or passing `null` SHALL create the task with no priority.

#### Scenario: Create task with priority
- **WHEN** a client calls `create_task` with `priority` = `3`
- **THEN** the created task's `priority` equals `3`

#### Scenario: Create task without priority
- **WHEN** a client calls `create_task` without `priority`
- **THEN** the created task's `priority` is `null` or absent in `get_tasks` output

#### Scenario: Create task with null priority
- **WHEN** a client calls `create_task` with `priority` = `null`
- **THEN** the call succeeds and the created task's `priority` is `null` or absent in `get_tasks` output

### Requirement: Set or clear priority on task update
`update_task` SHALL accept an optional `priority`. `1`, `2` or `3` SHALL set it; `null` SHALL clear it; omitting the parameter SHALL leave the existing priority unchanged.

#### Scenario: Set priority
- **WHEN** a client calls `update_task` with `priority` = `2`
- **THEN** the task's `priority` is `2`

#### Scenario: Clear priority
- **WHEN** a client calls `update_task` on a task with priority `3` and `priority` = `null`
- **THEN** the task's `priority` is `null` or absent in `get_tasks` output

#### Scenario: Priority left untouched
- **WHEN** a client calls `update_task` without `priority`
- **THEN** the task's existing priority is not modified

### Requirement: Bulk update priority with partial-success semantics
`bulk_update_tasks` SHALL accept an optional `priority` on each update item, with the same set/clear/untouched semantics as `update_task`. A failure on one item SHALL NOT prevent other items from being applied.

#### Scenario: Bulk set priority across tasks
- **WHEN** a client calls `bulk_update_tasks` with several items, each including `priority`
- **THEN** each referenced task's priority is updated per its own item

#### Scenario: One invalid task_id does not block the batch
- **WHEN** one item's `task_id` does not match an existing task
- **THEN** that item reports an error and every other item's priority is still updated

### Requirement: Priority on create_task_with_subtasks
`create_task_with_subtasks` SHALL accept an optional `priority` for the parent and for each subtask, with the same value domain as `create_task`.

#### Scenario: Parent and subtasks with different priorities
- **WHEN** a client calls `create_task_with_subtasks` with a parent `priority` = `3` and a subtask `priority` = `1`
- **THEN** the parent is created with priority `3` and that subtask with priority `1`

#### Scenario: Subtask without priority
- **WHEN** a subtask omits `priority`
- **THEN** that subtask's `priority` is `null` or absent in `get_tasks` output, regardless of the parent's priority

#### Scenario: Priority write fails after creation
- **WHEN** a priority write fails after the parent or a subtask was already created
- **THEN** the call returns an error naming the failing task and the already-created ids, and created tasks are not rolled back
