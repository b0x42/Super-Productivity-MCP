# Data Model: MCP Resources

**Feature**: MCP Resources (Read-Only Context)
**Created**: 2026-04-29
**Source**: [spec.md](spec.md)

## Resource Definitions

### `sp://projects`

Returns all projects. Reuses the existing `getProjects` IPC action.

**Response shape**:
```json
[
  { "id": "proj-abc", "title": "Work", "color": "#2196F3" },
  { "id": "proj-def", "title": "Personal", "color": "#4CAF50" }
]
```

**Fields**:

| Field | Type | Source |
|-------|------|--------|
| `id` | `string` | `project.id` |
| `title` | `string` | `project.title` |
| `color` | `string \| null` | `project.theme.primary` |

---

### `sp://tags`

Returns all tags. Reuses the existing `getTags` IPC action.

**Response shape**:
```json
[
  { "id": "tag-123", "title": "urgent", "color": "#FF5722", "icon": "warning" },
  { "id": "tag-456", "title": "backlog", "color": null, "icon": null }
]
```

**Fields**:

| Field | Type | Source |
|-------|------|--------|
| `id` | `string` | `tag.id` |
| `title` | `string` | `tag.title` |
| `color` | `string \| null` | `tag.theme.primary` |
| `icon` | `string \| null` | `tag.icon` |

---

### `sp://tasks/today`

Returns non-done tasks whose `plannedAt` falls within today (local timezone). Reuses `getTasks` with `plannedForToday: true` filter.

**Response shape**:
```json
[
  {
    "id": "task-1",
    "title": "Write report",
    "projectId": "proj-abc",
    "tagIds": ["tag-123"],
    "dueDay": "2026-04-29",
    "plannedAt": 1745910000000,
    "timeEstimate": 3600000,
    "timeSpent": 1200000,
    "parentId": null
  }
]
```

---

### `sp://tasks/overdue`

Returns non-done tasks whose `dueDay` is strictly before today. Reuses `getTasks` with `overdue: true` filter.

**Response shape**: Same as `sp://tasks/today`.

---

## Task Summary Fields

All task resources return this subset of task fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Task ID |
| `title` | `string` | Task title |
| `projectId` | `string \| null` | Assigned project |
| `tagIds` | `string[]` | Assigned tags |
| `dueDay` | `string \| null` | Due date (YYYY-MM-DD) |
| `plannedAt` | `number \| null` | Unix ms when planned for today |
| `timeEstimate` | `number` | Estimate in ms |
| `timeSpent` | `number` | Time spent in ms |
| `parentId` | `string \| null` | Parent task ID (null for top-level) |

## IPC Mapping

Resources reuse existing IPC actions — no new plugin commands needed.

| Resource URI | IPC Action | Filters |
|-------------|-----------|---------|
| `sp://projects` | `getProjects` | — |
| `sp://tags` | `getTags` | — |
| `sp://tasks/today` | `getTasks` | `{ plannedForToday: true }` |
| `sp://tasks/overdue` | `getTasks` | `{ overdue: true }` |

## Registration Pattern

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

server.registerResource('sp-projects', 'sp://projects', {
  description: 'All projects with IDs and colors',
  mimeType: 'application/json',
}, async (uri) => {
  const res = await sendCommand(dirs, 'getProjects', {});
  if (!res.success) throw new Error(res.error ?? 'SP not responding');
  return {
    contents: [{ uri: uri.href, text: JSON.stringify(res.result) }],
  };
});
```

## No New Plugin Changes

All four resources map to existing IPC actions (`getProjects`, `getTags`, `getTasks`). The plugin already handles these. The only new code is in the MCP server's resource registration layer.
