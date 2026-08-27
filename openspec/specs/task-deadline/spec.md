## Purpose

Task creation and update tools let clients set and clear a task's deadline (SP's `deadlineDay` field), independent of `dueDay`/`plannedAt`, using the same conventions already used for the existing due-date parameter.

## Requirements

### Requirement: Set deadline on task creation
`create_task` SHALL accept an optional `deadline_day` parameter (ISO date string, e.g. `2026-12-01`) and set it as the created task's `deadlineDay`.

#### Scenario: Create task with deadline
- **WHEN** a client calls `create_task` with `deadline_day` set to a valid ISO date
- **THEN** the created task's `deadlineDay` equals that date

### Requirement: Set or clear deadline on task update
`update_task` SHALL accept an optional `deadline_day` parameter. A non-empty ISO date string SHALL set the task's `deadlineDay`; an empty string SHALL clear it (set to `null`); omitting the parameter SHALL leave the existing `deadlineDay` unchanged.

#### Scenario: Set deadline
- **WHEN** a client calls `update_task` with `deadline_day` = `"2026-12-01"`
- **THEN** the task's `deadlineDay` is set to `"2026-12-01"`

#### Scenario: Clear deadline
- **WHEN** a client calls `update_task` with `deadline_day` = `""`
- **THEN** the task's `deadlineDay` is set to `null`

#### Scenario: Deadline left untouched
- **WHEN** a client calls `update_task` without `deadline_day`
- **THEN** the task's existing `deadlineDay` is not modified

### Requirement: Bulk update deadline with partial-success semantics
`bulk_update_tasks` SHALL accept an optional `deadline_day` field on each update item, following the same set/clear/untouched semantics as `update_task`. Consistent with `bulk_update_tasks`'s existing partial-success semantics, a failure updating one item's `deadline_day` SHALL NOT prevent other items in the same call from being applied.

#### Scenario: Bulk set deadline across multiple tasks
- **WHEN** a client calls `bulk_update_tasks` with updates for multiple `task_id`s, each including `deadline_day`
- **THEN** each referenced task's `deadlineDay` is updated independently per its own update item

#### Scenario: One invalid task_id does not block the rest of the batch
- **WHEN** a client calls `bulk_update_tasks` with `deadline_day` on multiple items, and one item's `task_id` does not correspond to an existing task
- **THEN** the update for the invalid `task_id` reports an error, and every other item's `deadlineDay` is still updated successfully
