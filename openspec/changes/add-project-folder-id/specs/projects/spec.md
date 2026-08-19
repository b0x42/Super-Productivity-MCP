## Purpose

Lets an MCP client create, list, and update Super Productivity projects, including placing a project into a navigation folder.

## ADDED Requirements

### Requirement: Create project
The system SHALL provide a `create_project` tool that creates a new Super Productivity project from a required `title` and optional `description`, `color`, and `folder_id` (`string | null`).

#### Scenario: Create project with title only
- **WHEN** `create_project` is called with only `title`
- **THEN** a new project is created with that title and no folder assignment

#### Scenario: Create project with missing title
- **WHEN** `create_project` is called with an empty or whitespace-only `title`
- **THEN** the tool returns an error result and no project is created

#### Scenario: Create project into a folder
- **WHEN** `create_project` is called with `title` and a non-empty `folder_id`
- **THEN** the new project is created with its folder assignment set to `folder_id`

#### Scenario: Create project with empty-string folder_id
- **WHEN** `create_project` is called with `folder_id` set to an empty or whitespace-only string
- **THEN** the tool returns an error result and no project is created

#### Scenario: Create project with unknown folder_id
- **WHEN** `create_project` is called with a `folder_id` that does not correspond to any existing folder
- **THEN** the system performs no local validation and forwards `folder_id` to the plugin API unchanged, surfacing whatever result or error the plugin API returns

### Requirement: List projects
The system SHALL provide a `get_projects` tool that returns all Super Productivity projects, including each project's folder assignment when one is set.

#### Scenario: List projects including folder assignment
- **WHEN** `get_projects` is called and a returned project belongs to a folder
- **THEN** that project's folder identifier is present in the result

### Requirement: Update project
The system SHALL provide an `update_project` tool that updates an existing project's `title`, `color`, and/or folder assignment (`folder_id`, `string | null`), identified by `project_id`.

#### Scenario: Update project missing project_id
- **WHEN** `update_project` is called with an empty or whitespace-only `project_id`
- **THEN** the tool returns an error result and no project is updated

#### Scenario: Move project into a folder
- **WHEN** `update_project` is called with `project_id` and a non-empty `folder_id`
- **THEN** the project's folder assignment is set to `folder_id`

#### Scenario: Update project without touching folder assignment
- **WHEN** `update_project` is called with `project_id` and `title` but `folder_id` omitted
- **THEN** the project's title is updated and its existing folder assignment is left unchanged

#### Scenario: Clear project's folder assignment
- **WHEN** `update_project` is called with `project_id` and `folder_id` explicitly set to `null`
- **THEN** the project's folder assignment is cleared, moving it back to the root of the project navigation

#### Scenario: Update project with empty-string folder_id
- **WHEN** `update_project` is called with `folder_id` set to an empty or whitespace-only string
- **THEN** the tool returns an error result and no project is updated

#### Scenario: Update project with unknown folder_id
- **WHEN** `update_project` is called with a `folder_id` that does not correspond to any existing folder
- **THEN** the system performs no local validation and forwards `folder_id` to the plugin API unchanged, surfacing whatever result or error the plugin API returns

### Requirement: Folder ID discovery caveat
The `create_project` and `update_project` tool descriptions SHALL state that folder identifiers cannot be discovered through this server and must be obtained from the Super Productivity UI, since the plugin API exposes no method to list folders.

#### Scenario: Tool description communicates the caveat
- **WHEN** a client reads the `create_project` or `update_project` tool description
- **THEN** the description states that `folder_id` values are not discoverable via any tool in this server and must come from the Super Productivity UI
