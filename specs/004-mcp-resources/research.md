# Research: Super Productivity Wiki & Plugin API

**Feature**: MCP Resources (Read-Only Context)
**Created**: 2026-04-29
**Source**: [SP Wiki](https://github.com/super-productivity/super-productivity/wiki), [Plugin Development Guide](https://github.com/super-productivity/super-productivity/blob/master/docs/plugin-development.md), [API Reference](https://github.com/super-productivity/super-productivity/wiki/3.01-API)

## Key Findings

### Plugin API Methods (relevant to resources)

The PluginAPI exposes these read methods our plugin already uses:

| Method | Returns | Notes |
|--------|---------|-------|
| `getTasks()` | All active (non-archived, non-done) tasks | Our plugin uses this |
| `getArchivedTasks()` | Archived tasks | Available but not used for resources |
| `getCurrentContextTasks()` | Tasks in current view context | Not useful for MCP |
| `getAllProjects()` | All projects | Our plugin uses this |
| `getAllTags()` | All tags | Our plugin uses this |

### Local REST API (alternative approach — NOT used)

SP also has a Local REST API on `http://127.0.0.1:3876` (Electron only, disabled by default). Endpoints:
- `GET /tasks` — with filters (query, projectId, tagId, includeDone, source)
- `GET /projects` — with optional query filter
- `GET /tags` — with optional query filter
- `GET /task-control/current` — current task
- `GET /status` — current task + task count

This is **not** relevant to our MCP Resources implementation since:
1. It requires Electron desktop app (not web)
2. Must be manually enabled in settings
3. Our plugin-based IPC works on all platforms

### Plugin Hooks (potential future use for resource change notifications)

Available hooks that could trigger resource invalidation:
- `taskCreated` — new task added
- `taskComplete` — task marked done
- `taskUpdate` — task modified
- `taskDelete` — task removed
- `currentTaskChange` — timer started/stopped
- `projectListUpdate` — projects changed
- `persistedDataUpdate` — any data persisted

**Future v2 consideration**: The plugin could use these hooks to write a "change signal" file that the MCP server watches, enabling `notifications/resources/list_changed` to be sent to clients.

### Task Fields Available from PluginAPI.getTasks()

From the plugin-api types and Local REST API docs, tasks include:
- `id`, `title`, `notes`
- `isDone`, `doneOn`
- `projectId`, `tagIds[]`
- `parentId`, `subTaskIds[]`
- `timeEstimate`, `timeSpent`
- `dueDay` (YYYY-MM-DD string), `dueWithTime` (Unix ms)
- `plannedAt` (Unix ms — when planned for today)
- `timeSpentOnDay` (object: `{ [date]: ms }`)

### Project Fields from PluginAPI.getAllProjects()

- `id`, `title`
- `theme.primary` (color)
- `taskIds[]`, `backlogTaskIds[]`
- `isArchived`, `isHiddenFromMenu`

### Tag Fields from PluginAPI.getAllTags()

- `id`, `title`
- `theme.primary` (color)
- `icon`
- `taskIds[]`

## Implications for Spec

1. **No new plugin code needed** — confirmed. `getTasks()`, `getAllProjects()`, `getAllTags()` are already available and used by our plugin's existing handlers.

2. **Field mapping is straightforward** — the data model in our spec correctly maps to the actual SP data structures.

3. **Future optimization path** — hooks like `projectListUpdate` and `persistedDataUpdate` could enable push-based resource invalidation in a v2.

4. **`batchUpdateForProject`** — SP has a batch API for projects that could be useful for future resource optimizations but isn't needed for read-only resources.
