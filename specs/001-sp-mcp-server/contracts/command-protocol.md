# Command Protocol Contract

Version: 1 (protocolVersion field value)

## Command Actions

### Task Operations

| Action | Required Fields | Optional Fields | Response `result` |
|--------|----------------|-----------------|-------------------|
| `addTask` | `data.title` | `data.notes`, `data.projectId`, `data.parentId`, `data.tagIds` | Task ID (string) |
| `getTasks` | — | `filters.projectId`, `filters.tagId`, `filters.includeDone`, `filters.searchQuery` | Task[] |
| `updateTask` | `taskId` | `data.title`, `data.notes`, `data.isDone`, `data.doneOn`, `data.timeEstimate`, `data.timeSpent` | Task |
| `setTaskDone` | `taskId` | — | Task |

### Project Operations

| Action | Required Fields | Optional Fields | Response `result` |
|--------|----------------|-----------------|-------------------|
| `getAllProjects` | — | — | Project[] |
| `addProject` | `data.title` | `data.description`, `data.color` | Project ID (string) |
| `updateProject` | `projectId` | `data.title`, `data.theme` | Project |

### Tag Operations

| Action | Required Fields | Optional Fields | Response `result` |
|--------|----------------|-----------------|-------------------|
| `getAllTags` | — | — | Tag[] |
| `addTag` | `data.title` | `data.color` | Tag ID (string) |
| `updateTag` | `tagId` | `data.title`, `data.color`, `data.icon` | Tag |

### UI Operations

| Action | Required Fields | Optional Fields | Response `result` |
|--------|----------------|-----------------|-------------------|
| `showSnack` | `message` | `type` (SUCCESS/INFO/WARNING/ERROR) | `{ success: true }` |

### Diagnostic Operations

| Action | Required Fields | Optional Fields | Response `result` |
|--------|----------------|-----------------|-------------------|
| `ping` | — | — | `{ pong: true, pluginVersion: string, protocolVersion: number }` |

## MCP Tool → Command Action Mapping

| MCP Tool | Command Action | Notes |
|----------|---------------|-------|
| `create_task` | `addTask` | Plugin uses two-step workaround for subtasks with SP syntax |
| `get_tasks` | `getTasks` | Plugin returns tasks (+ archived if requested); server filters by `filters` |
| `update_task` | `updateTask` | |
| `complete_task` | `setTaskDone` | |
| `get_projects` | `getAllProjects` | |
| `create_project` | `addProject` | |
| `update_project` | `updateProject` | |
| `get_tags` | `getAllTags` | |
| `create_tag` | `addTag` | |
| `update_tag` | `updateTag` | |
| `show_notification` | `showSnack` | |
| `check_connection` | `ping` | Server-side timeout → clear error message |
| `debug_directories` | — | Server-only, no IPC needed |

## Error Responses

All errors follow the same response format:

```json
{
  "success": false,
  "error": "Human-readable error message",
  "timestamp": 1713600000000
}
```

Standard error messages:
- `"Task not found"` — taskId doesn't match any task
- `"Project not found"` — projectId doesn't match any project
- `"Tag not found"` — tagId doesn't match any tag
- `"Title is required"` — create operation with empty/missing title
- `"Unsupported protocol version X. Plugin supports up to version Y. Please update the plugin."` — version mismatch
- `"Unknown command action: X"` — unrecognized action

## Protocol Version Rules

- Current version: `1`
- Plugin accepts commands with `protocolVersion <= 1`
- Plugin rejects commands with `protocolVersion > 1` with an error response
- Adding new optional fields to existing actions: no version bump
- Adding new actions: no version bump (plugin returns "Unknown command action" for unrecognized actions)
- Changing semantics of existing actions or adding required fields: version bump required
ired
