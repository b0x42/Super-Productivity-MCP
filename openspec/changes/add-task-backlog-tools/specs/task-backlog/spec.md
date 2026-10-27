## Purpose

Lets an MCP client move top-level tasks between a project's regular list and its backlog, and prevents task reordering from duplicating backlog tasks.

## ADDED Requirements

### Requirement: Move tasks between regular list and backlog
The system SHALL provide a `move_tasks_backlog` tool taking `task_ids` and a `destination` of `backlog` or `regular`. It SHALL move each task within its own project from one list to the other, so the task is in exactly one of them afterwards, appended to the end of the destination list in `task_ids` order.

#### Scenario: Move task into backlog
- **WHEN** `move_tasks_backlog` is called with a task in its project's regular list and `destination` `backlog`
- **THEN** the task is no longer in the project's regular list and is in its backlog

#### Scenario: Move task out of backlog
- **WHEN** `move_tasks_backlog` is called with a task in its project's backlog and `destination` `regular`
- **THEN** the task is no longer in the backlog and is in the project's regular list

#### Scenario: Moved tasks are appended in request order
- **WHEN** tasks `b` and `a`, in that order, are moved to a backlog that already holds `c`
- **THEN** the backlog is `c`, `b`, `a`

#### Scenario: Task in both lists is repaired
- **WHEN** a task is in both the regular list and the backlog of its project and is moved to either destination
- **THEN** the task is in exactly one list, the destination, and appears in `moved`

#### Scenario: Bulk move across projects
- **WHEN** `move_tasks_backlog` is called with tasks from several projects
- **THEN** every task is moved within its own project

### Requirement: Report moved and unchanged tasks
On success the `move_tasks_backlog` tool SHALL return `moved` (IDs whose lists changed) and `unchanged` (IDs already in the destination list). A task already in the destination list SHALL NOT be an error.

#### Scenario: Task already at destination
- **WHEN** a task is already in the destination list
- **THEN** the call succeeds, the task ID is in `unchanged` and not in `moved`, and no duplicate entry is created

### Requirement: Batch input limits
The `move_tasks_backlog` tool SHALL accept 1 to 100 entries in `task_ids` and SHALL process duplicate IDs once, at the position of their first occurrence. Input validation follows the `mcp-tool-input-validation` capability.

#### Scenario: Empty task_ids
- **WHEN** `move_tasks_backlog` is called with an empty `task_ids`
- **THEN** the tool returns an error result

#### Scenario: Too many task_ids
- **WHEN** `move_tasks_backlog` is called with more than 100 `task_ids`
- **THEN** the tool returns an error result and no task is moved

#### Scenario: Duplicate task_ids
- **WHEN** the same ID appears twice in `task_ids`
- **THEN** the task is moved once and appears once in `moved`

### Requirement: Validate before writing
The system SHALL validate every task in a `move_tasks_backlog` call before writing anything. If any task fails validation, the tool SHALL return an error naming the task and SHALL NOT change any project. If a project write fails after validation, the tool SHALL return an error naming the failed project and the projects already written.

#### Scenario: Unknown task
- **WHEN** one of the `task_ids` does not exist
- **THEN** the tool returns an error naming that task and no task is moved

#### Scenario: Subtask
- **WHEN** one of the `task_ids` is a subtask
- **THEN** the tool returns an error naming that task and no task is moved

#### Scenario: Task without project
- **WHEN** one of the `task_ids` has no project
- **THEN** the tool returns an error naming that task and no task is moved

#### Scenario: Project not found
- **WHEN** one of the `task_ids` has a `projectId` that matches no project
- **THEN** the tool returns an error naming that task and no task is moved

#### Scenario: Task in neither list
- **WHEN** a task's project lists it in neither the regular list nor the backlog
- **THEN** the tool returns an error naming that task and no task is moved

#### Scenario: Write fails mid-batch
- **WHEN** validation passes for tasks in several projects and the write for one project fails
- **THEN** the tool returns an error naming the failed project and the projects already written

### Requirement: Refuse moves into a disabled backlog
The system SHALL refuse to move a task into the backlog of a project whose backlog is disabled (`isEnableBacklog` false), because the task would not be visible in the Super Productivity UI. Moving a task to the regular list SHALL still be allowed so stranded tasks can be recovered.

#### Scenario: Move into disabled backlog
- **WHEN** `move_tasks_backlog` is called with `destination` `backlog` for a task whose project has `isEnableBacklog` false
- **THEN** the tool returns an error naming the project and no task is moved

#### Scenario: Recover task from disabled backlog
- **WHEN** `move_tasks_backlog` is called with `destination` `regular` for a task in the `backlogTaskIds` of a project with `isEnableBacklog` false
- **THEN** the task is moved to the project's regular list

### Requirement: Reorder rejects backlog tasks
The system SHALL reject a `reorder_tasks` call with `context_type` `project` that includes a task ID in that project's backlog, and SHALL NOT change the project.

#### Scenario: Reorder includes backlog task
- **WHEN** `reorder_tasks` is called for a project with a task ID that is in the project's backlog
- **THEN** the tool returns an error naming the task and pointing to `move_tasks_backlog`, and the project's lists are unchanged
