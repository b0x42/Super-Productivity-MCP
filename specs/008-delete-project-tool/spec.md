# Feature Specification: Delete Project Tool

**Feature Branch**: `008-delete-project-tool`
**Created**: 2026-10-14
**Status**: Draft
**Input**: User description: "Add a delete_project MCP tool that permanently deletes a project in Super Productivity, mirroring the existing delete_task tool's pattern, by wiring up the plugin API's deleteProject(projectId) method (new in SP v19.0.1) through projects.ts and plugin/plugin.js."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Delete a project through the MCP server (Priority: P1)

An AI assistant connected to this MCP server is asked to remove a project (e.g. "delete the 'Website Relaunch' project, I don't need it anymore"). The assistant looks up the project ID via `get_projects`, then calls a new `delete_project` tool with that ID. Super Productivity permanently removes the project and the tasks it contains, matching what clicking "Delete project" in the UI does.

**Why this priority**: This is the only user story in this feature. Project create/get/update already exist; delete is the one CRUD gap on projects, and it is the direct trigger for this work.

**Independent Test**: Create a project via `create_project`, add a task to it via `create_task`, call `delete_project` with the project's ID, then call `get_projects` and `get_tasks` to confirm both the project and its task are gone.

**Acceptance Scenarios**:

1. **Given** a project exists with no tasks, **When** `delete_project` is called with that project's ID, **Then** the project no longer appears in `get_projects` results.
2. **Given** a project exists with one or more tasks assigned to it, **When** `delete_project` is called with that project's ID, **Then** the project is removed and its tasks no longer appear in `get_tasks` (including with `include_done`/`include_archived` filters).
3. **Given** the Inbox project, **When** `delete_project` is called with the Inbox's project ID, **Then** the call fails with an error explaining the Inbox cannot be deleted, and the Inbox and its tasks remain unchanged.
4. **Given** the project being deleted is the user's current active work context in the Super Productivity UI, **When** `delete_project` is called, **Then** the deletion succeeds and the UI falls back to the Today view (matching native app behavior), with no error surfaced to the caller.
5. **Given** a project ID that does not exist, **When** `delete_project` is called with that ID, **Then** the call returns an error rather than silently succeeding.

### Edge Cases

- Calling `delete_project` twice in a row with the same ID (second call targets an already-deleted project): second call MUST return an error, not a silent success.
- Calling `delete_project` with an empty or whitespace-only project ID: MUST be rejected before any call reaches Super Productivity, consistent with how `delete_task` and other tools validate IDs.
- Deleting a project that is the sole project assigned to a long-running recurring task configuration: deletion proceeds; the task repeat configuration's fate follows whatever Super Productivity's own `deleteProject` cascade already does (no new MCP-side logic is introduced to second-guess it).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The MCP server MUST expose a `delete_project` tool that accepts a single required `project_id` string parameter.
- **FR-002**: `delete_project` MUST reject calls where `project_id` is missing, empty, or whitespace-only, returning an error before contacting Super Productivity, mirroring `delete_task`'s existing validation.
- **FR-003**: On a valid, existing, non-Inbox project ID, `delete_project` MUST remove the project and all tasks it contains, matching the cascade behavior of Super Productivity's own `deleteProject` plugin API method.
- **FR-004**: `delete_project` MUST reject deletion of the Inbox project and return an error explaining why, without deleting any data.
- **FR-005**: `delete_project` MUST return an error (not a silent success) when the given `project_id` does not correspond to any existing project.
- **FR-006**: On success, `delete_project` MUST return a result indicating the deletion succeeded, following the same minimal success-result shape as `delete_task`.
- **FR-007**: The underlying plugin bridge (`plugin/plugin.js`) MUST add a command handler that calls Super Productivity's `PluginAPI.deleteProject(projectId)` and surfaces its errors (including the Inbox-deletion refusal) back through the existing IPC response format.
- **FR-008**: The tool's description text MUST state plainly that this deletes the project AND its contained tasks, so a calling assistant cannot invoke it expecting a "move tasks out first" semantics.

### Key Entities *(include if feature involves data)*

- **Project**: Existing entity (see `get_projects`/`create_project`/`update_project`). This feature adds a terminal lifecycle operation (deletion) with no new attributes.
- **Task**: Existing entity. Tasks belonging to a deleted project are removed as a cascading side effect; no new task attributes are introduced.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An assistant can remove an unwanted project and all of its tasks in a single tool call, with no manual task cleanup step required beforehand.
- **SC-002**: 100% of attempts to delete the Inbox project are rejected with a clear error, with zero data loss.
- **SC-003**: 100% of attempts to delete a non-existent project ID return an error rather than a false "success".
- **SC-004**: Deleting a project that is also the user's active context in the Super Productivity UI never leaves the UI in a broken or errored state (it falls back to Today, matching native behavior).

## Assumptions

- Super Productivity's own `PluginAPI.deleteProject(projectId)` already implements the cascade (project + tasks) and the Inbox-deletion refusal; this feature wires it up and surfaces its results, it does not reimplement that logic.
- The minimum Super Productivity version already declared in `plugin/manifest.json` may need to be raised to cover the release that introduced `deleteProject` (v19.0.1 per the public changelog); confirming and updating that minimum version is in scope for implementation, not a product decision requiring further clarification.
- No bulk/multi-project delete is in scope — this mirrors `delete_task` (single ID per call), not `bulk_complete_tasks`.
- No confirmation/dry-run step is introduced inside the MCP tool itself; the calling assistant is responsible for confirming destructive intent with its own user before invoking `delete_project`, consistent with how `delete_task` already works today.
