# Data Model: Delete Project Tool

No new persistent entities, fields, or state transitions are introduced. This feature adds one terminal operation to an existing entity's lifecycle.

## Project (existing entity — no attribute changes)

Source of truth: Super Productivity itself, read via `PluginAPI.getAllProjects()` / mutated via `PluginAPI.deleteProject()`. This MCP server never stores project state of its own.

| Field (relevant to this feature) | Type | Notes |
|---|---|---|
| `id` | string | The identifier `delete_project` operates on. The literal value `'INBOX_PROJECT'` is reserved and MUST be rejected before calling the host (see Research: Inbox refusal). |
| `title` | string | Unused by this feature except for error messages ("Project not found" has no title to echo back; "Cannot delete Inbox" does not need it either since it's a fixed, well-known project). |

### Lifecycle addition

```text
[active project, 0..n tasks] --delete_project(id)--> [removed; tasks also removed]
```

- Terminal: once deleted, the project cannot be targeted again (`delete_project` on the same ID a second time MUST error — Edge Case in spec.md).
- No soft-delete / undo is introduced by this feature — deletion is as permanent as Super Productivity's own `PluginAPI.deleteProject` makes it.

## Task (existing entity — no attribute changes, cascading side effect only)

When a project is deleted, all tasks with that `projectId` are removed as a side effect of `PluginAPI.deleteProject`, exactly as the native "Delete project" UI action does. This feature does not add logic to select, filter, or specially handle which tasks are swept up — the cascade is entirely owned by the host method (see Research and spec Assumptions).

## IPC Command/Response shapes (existing types — no schema change)

`src/ipc/types.ts`'s `Command` interface already has an optional `projectId?: string` field (used today by other project-scoped commands). The new `deleteProject` action reuses it as-is:

**Request** (`Command`):
```json
{
  "id": "<uuid>",
  "action": "deleteProject",
  "protocolVersion": 1,
  "timestamp": 1234567890,
  "projectId": "proj-abc123"
}
```

**Response, success** (`Response`):
```json
{
  "success": true,
  "result": null,
  "timestamp": 1234567890
}
```
(Mirrors `deleteTask`'s existing response shape — `result: null` on success, nothing more to report.)

**Response, failure — not found**:
```json
{
  "success": false,
  "error": "Project not found: proj-abc123",
  "timestamp": 1234567890
}
```

**Response, failure — Inbox refusal**:
```json
{
  "success": false,
  "error": "The Inbox project cannot be deleted.",
  "timestamp": 1234567890
}
```

No new fields are added to `Command` or `Response` — `PROTOCOL_VERSION` does not need to be incremented (Constitution "Protocol Versioning": only required when a new required field is added, a command's semantics change, or a response schema changes in a breaking way; this is a new value for the existing, already-free-form `action` string, using an already-existing optional field).
