## Purpose

Lets an MCP client move top-level tasks between a project's regular list and its backlog, and prevents task reordering from duplicating backlog tasks.

## ADDED Requirements

### Requirement: Move tasks between regular list and backlog
The system SHALL provide a `move_tasks_backlog` tool that takes a non-empty `task_ids` array and a `destination` of `backlog` or `regular`, and moves each task within its own project: to `backlog` removes it from the project's regular list and adds it to the backlog; to `regular` removes it from the backlog and adds it to the regular list. A task SHALL be in exactly one of the two lists after the move.

#### Scenario: Move task into backlog
- **WHEN** `move_tasks_backlog` is called with a task in its project's regular list and `destination` `backlog`
- **THEN** the task is no longer in the project's regular list and is in its backlog

#### Scenario: Move task out of backlog
- **WHEN** `move_tasks_backlog` is called with a task in its project's backlog and `destination` `regular`
- **THEN** the task is no longer in the backlog and is in the project's regular list

#### Scenario: Bulk move across projects
- **WHEN** `move_tasks_backlog` is called with tasks from several projects
- **THEN** every task is moved within its own project, using one project write per affected project

#### Scenario: Task already at destination
- **WHEN** a task is already in the destination list
- **THEN** the call succeeds, the task is reported as unchanged, and no duplicate entry is created

#### Scenario: Empty task_ids
- **WHEN** `move_tasks_backlog` is called with an empty `task_ids`
- **THEN** the tool returns an error result

### Requirement: Move validation is all-or-nothing
The system SHALL validate every task in a `move_tasks_backlog` call before changing anything. If any task fails validation, the tool SHALL return an error naming the task and SHALL NOT change any project.

#### Scenario: Unknown task
- **WHEN** one of the `task_ids` does not exist
- **THEN** the tool returns an error naming that task and no task is moved

#### Scenario: Subtask
- **WHEN** one of the `task_ids` is a subtask
- **THEN** the tool returns an error naming that task and no task is moved

#### Scenario: Task without project
- **WHEN** one of the `task_ids` has no project
- **THEN** the tool returns an error naming that task and no task is moved

#### Scenario: Task in neither list
- **WHEN** a task's project lists it in neither the regular list nor the backlog
- **THEN** the tool returns an error naming that task and no task is moved

### Requirement: Refuse moves when backlog is disabled
The system SHALL refuse to move a task in a project whose backlog is disabled (`isEnableBacklog` false), in either direction, because the task would not be visible in the Super Productivity UI.

#### Scenario: Backlog disabled
- **WHEN** `move_tasks_backlog` includes a task whose project has `isEnableBacklog` false
- **THEN** the tool returns an error naming the project and no task is moved

### Requirement: Reorder rejects backlog tasks
The system SHALL reject a `reorder_tasks` call with `context_type` `project` that includes a task ID in that project's backlog, and SHALL NOT change the project.

#### Scenario: Reorder includes backlog task
- **WHEN** `reorder_tasks` is called for a project with a task ID that is in the project's backlog
- **THEN** the tool returns an error naming the task and pointing to `move_tasks_backlog`, and the project's lists are unchanged
