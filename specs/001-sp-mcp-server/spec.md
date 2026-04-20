# Feature Specification: Super Productivity MCP Server

**Feature Branch**: `001-sp-mcp-server`
**Created**: 2026-04-20
**Status**: Draft
**Input**: User description: "Build an MCP Server for Super Productivity based on the reference SP-MCP project. Must integrate into Super Productivity as a plugin. Improve upon the unmaintained reference by addressing its open issues and PRs."

## Clarifications

### Session 2026-04-20

- Q: What should the default plugin polling interval be? → A: 2 seconds (reference project default), balancing latency vs CPU usage.
- Q: What file permission model should the IPC directories use? → A: User-only (directories 700, files 600) — only the owning user can read/write.
- Q: What filtering approach for `get_tasks`? → A: Full filtering — filter by project ID, tag ID, done status, and title search query.

## User Scenarios & Testing

### User Story 1 — Manage Tasks via AI Assistant (Priority: P1)

A user opens their AI assistant (Claude Desktop, Kiro, or any MCP-compatible client) and asks it to create, view, update, and complete tasks in Super Productivity. The assistant uses the MCP server to execute these operations, and the user sees the results reflected in Super Productivity immediately.

**Why this priority**: Task management is the core value proposition. Without reliable task CRUD, no other feature matters.

**Independent Test**: Create a task via the MCP client, verify it appears in Super Productivity's Inbox. Update its title and notes, verify changes. Mark it complete, verify it's done. List all tasks and confirm the output matches SP's state.

**Acceptance Scenarios**:

1. **Given** the MCP server and SP plugin are running, **When** the user asks the AI to "create a task called Review quarterly budget", **Then** a task titled "Review quarterly budget" appears in Super Productivity's Inbox (no project, no scheduled date).
2. **Given** a task exists in SP, **When** the user asks the AI to "mark the quarterly budget task as done", **Then** the task is marked complete in SP with a `doneOn` timestamp.
3. **Given** tasks exist in SP, **When** the user asks the AI to "show me all my tasks", **Then** the AI returns a list of all tasks with their titles, status, project, and tags.
4. **Given** tasks exist across multiple projects, **When** the user asks "show me tasks in the Website Redesign project", **Then** only tasks assigned to that project are returned.
5. **Given** a task exists, **When** the user asks to "update the task notes to include the agenda items", **Then** the task's notes field is updated in SP.
6. **Given** the user wants a subtask, **When** they ask to "add a subtask 'Prepare slides' under the budget review task", **Then** a subtask is created with the correct parent relationship.
7. **Given** the user includes SP syntax in a title like "Buy groceries @tomorrow #errands +personal", **When** the task is created, **Then** SP interprets the scheduling, tag, and project syntax natively.

---

### User Story 2 — Manage Projects and Tags (Priority: P2)

A user manages their organizational structure through the AI assistant — creating projects, creating tags, and viewing existing ones.

**Why this priority**: Projects and tags are how users organize tasks in SP. Without them, task management is flat and less useful.

**Independent Test**: Create a project via MCP, verify it appears in SP. Create a tag, verify it appears. List all projects and tags, confirm they match SP's state.

**Acceptance Scenarios**:

1. **Given** the MCP server is running, **When** the user asks to "create a project called Website Redesign", **Then** a project with that title appears in SP.
2. **Given** projects exist, **When** the user asks to "show me all projects", **Then** the AI returns a list of all projects with their titles and IDs.
3. **Given** the MCP server is running, **When** the user asks to "create a tag called urgent with red color", **Then** a tag with that title and color appears in SP.
4. **Given** tags exist, **When** the user asks to "list all tags", **Then** the AI returns all tags with their titles, colors, and IDs.
5. **Given** a project exists, **When** the user asks to "update the Website Redesign project color to blue", **Then** the project's theme color is updated in SP.
6. **Given** a tag exists, **When** the user asks to "update the urgent tag icon", **Then** the tag is updated in SP.

---

### User Story 3 — Connection Health and Diagnostics (Priority: P3)

A user wants to verify that the MCP server can communicate with Super Productivity, or troubleshoot when things aren't working.

**Why this priority**: Without diagnostics, users have no way to tell if the system is working or why it's failing. Essential for onboarding and support.

**Independent Test**: Run `check_connection` with SP running — get success. Close SP, run `check_connection` — get a clear error message. Run `debug_directories` — see the resolved paths.

**Acceptance Scenarios**:

1. **Given** SP is running with the plugin enabled, **When** the user asks the AI to "check the Super Productivity connection", **Then** the AI reports: connected, plugin version, protocol version, and data directory paths.
2. **Given** SP is not running, **When** the user asks to check the connection, **Then** the AI reports: "Super Productivity is not responding. Ensure the app is running with the MCP Bridge plugin enabled."
3. **Given** the user wants to troubleshoot paths, **When** they ask to "show debug info", **Then** the AI returns the resolved data directory, command directory, response directory, and whether they exist.

---

### User Story 4 — Notifications (Priority: P4)

A user asks the AI to show a notification inside Super Productivity's UI.

**Why this priority**: Nice-to-have for user feedback, but not core to task management.

**Independent Test**: Send a notification via MCP, verify the snackbar appears in SP.

**Acceptance Scenarios**:

1. **Given** SP is running, **When** the user asks the AI to "show a notification saying 'Tasks synced successfully'", **Then** a success snackbar appears in SP's UI.

---

### Edge Cases

- What happens when the user creates a task with an empty title? The system rejects it with a clear error.
- What happens when the user references a non-existent task ID for update/complete? The plugin returns an error with "Task not found".
- What happens when multiple MCP clients send commands simultaneously? Commands are processed sequentially by the plugin's polling loop; no data corruption occurs.
- What happens when the data directory has restrictive permissions? The system reports a clear error on startup about directory access.
- What happens when command/response files are corrupted (invalid JSON)? The plugin logs the error, skips the file, and cleans it up.

## Requirements

### Functional Requirements

- **FR-001**: System MUST allow creating tasks with a title, optional notes, optional project assignment, optional parent task, and optional tag IDs.
- **FR-002**: System MUST allow listing tasks with optional filters: by project ID, by tag ID, by done status (include/exclude completed), by archived status (include/exclude archived), and by title search query. When no filters are provided, all non-done, non-archived tasks are returned.
- **FR-003**: System MUST allow updating any mutable task field: title, notes, done status, time estimate, time spent.
- **FR-004**: System MUST allow marking a task as complete (setting `isDone` and `doneOn`).
- **FR-005**: System MUST allow creating projects with a title, optional description, and optional color.
- **FR-006**: System MUST allow listing all projects with their IDs, titles, and archive status.
- **FR-007**: System MUST allow updating project properties (title, color, theme).
- **FR-008**: System MUST allow creating tags with a title and optional color.
- **FR-009**: System MUST allow listing all tags with their IDs, titles, and colors.
- **FR-010**: System MUST allow updating tag properties (title, color, icon).
- **FR-011**: System MUST allow showing notifications in Super Productivity's UI.
- **FR-012**: System MUST provide a connection health check that reports status, plugin version, protocol version, and directory paths.
- **FR-013**: System MUST provide a debug tool that reports resolved directory paths and their existence status.
- **FR-014**: Tasks created without a project assignment MUST land in Super Productivity's Inbox, not in "Today" or any other default context.
- **FR-015**: System MUST pass task titles through verbatim so Super Productivity can interpret its native syntax (`@`, `#`, `+`).
- **FR-016**: System MUST handle subtask creation with SP syntax by using the two-step create-then-update workaround.
- **FR-017**: System MUST work on macOS (standard, App Store sandbox, Homebrew), Linux (standard, Snap), and Windows without user configuration.
- **FR-018**: System MUST support a `SP_MCP_DATA_DIR` environment variable to override automatic directory detection.
- **FR-019**: Command files MUST include a protocol version for forward compatibility between independently updated components.
- **FR-020**: System MUST clean up stale command/response files on startup and orphaned command files on timeout.
- **FR-021**: The SP plugin MUST poll for new command files every 2 seconds by default. The polling interval MUST be configurable by the user via plugin settings.
- **FR-022**: IPC directories MUST be created with user-only permissions (700 for directories, 600 for files) to prevent other users on shared machines from reading task data.

### Key Entities

- **Task**: The primary work item. Has title, notes, status (done/not done), project assignment, tag assignments, parent task (for subtasks), time tracking fields, and scheduling metadata.
- **Project**: An organizational container for tasks. Has title, color/theme, archive status, and associated task IDs.
- **Tag**: A cross-cutting label for tasks. Has title, color, icon, and associated task IDs.
- **Command**: A JSON file representing an operation request from the MCP server to the plugin. Has ID, action, protocol version, timestamp, and action-specific data.
- **Response**: A JSON file representing the result of a command. Has success flag, optional result data, optional error message, and timestamp.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Users can create, read, update, and complete tasks through any MCP-compatible AI assistant within 5 seconds per operation (including round-trip through file-based IPC).
- **SC-002**: Users can manage projects and tags (create, list, update) through the AI assistant within 5 seconds per operation.
- **SC-003**: The system works out of the box on macOS, Linux, and Windows without manual directory configuration for standard Super Productivity installations.
- **SC-004**: When Super Productivity is not running, the user receives a clear, actionable error message within the configured timeout period.
- **SC-005**: The system correctly handles Super Productivity's native task syntax (`@`, `#`, `+`) in 100% of cases where SP itself would handle it.
- **SC-006**: No orphaned command or response files remain in the data directory after normal operation or after error recovery.
- **SC-007**: The system can be installed and configured by a user following the README in under 5 minutes (npm install + plugin upload + MCP client config).

## Assumptions

- Users have Super Productivity version 14.0.0 or higher installed (plugin API requirement).
- Users have Node.js 18 or higher available for running the MCP server.
- Users have an MCP-compatible client (Claude Desktop, Kiro, or similar) already configured.
- The Super Productivity Plugin API (`PluginAPI`) is stable and backward-compatible within the 14.x release line.
- File system operations (read/write JSON files) complete within milliseconds on all target platforms — the 30-second timeout is for plugin polling latency, not I/O.
- Only one instance of the MCP server communicates with one instance of Super Productivity at a time. Multi-instance scenarios are out of scope for v1.
