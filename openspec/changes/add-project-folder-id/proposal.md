## Why

Super Productivity's plugin API exposes `Project.folderId` (nullable string) so a project can belong to a navigation folder, and `addProject`/`updateProject` both accept `Partial<Project>` so setting it is already reachable. The MCP server's `create_project` and `update_project` tools don't expose a `folder_id` parameter, so an assistant using this server can't place a new project into a folder or move an existing one — the user has to finish that step by hand in the Super Productivity UI. Tracked as GitHub issue #94.

## What Changes

- `create_project`: add optional `folder_id` input (`string | null`), mapped to `data.folderId`.
- `update_project`: add optional `folder_id` input (`string | null`), mapped to `data.folderId`. Passing `null` clears the project's folder assignment; omitting the field leaves it unchanged; an empty/whitespace-only string is rejected as an error.
- Both tool descriptions gain a caveat: the plugin API has no folder-listing method (`ProjectFolder` type exists upstream but isn't exposed via a getter — see super-productivity/super-productivity#9600), so `folder_id` must be obtained from the Super Productivity UI, not discovered through this server.
- `get_projects` needs no code change — it already returns raw `Project` objects from `getAllProjects()`, so `folderId` surfaces automatically when set.

## Capabilities

### New Capabilities
- `projects`: MCP tools for creating, reading, and updating Super Productivity projects (`create_project`, `get_projects`, `update_project`), including project-folder assignment via `folder_id`.

### Modified Capabilities
(none — `projects` has no existing spec to modify; this is its first spec)

## Impact

- Code: `src/tools/projects.ts` (`create_project`, `update_project` input schemas and handlers).
- No IPC/plugin.js changes needed — `addProject`/`updateProject` commands already forward `data` untouched to the plugin API (plugin/plugin.js:291-295).
- No breaking changes — `folder_id` is optional and additive.
