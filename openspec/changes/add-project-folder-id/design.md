## Context

See proposal.md - Why. Confirmed against upstream `packages/plugin-api/src/types.ts` (super-productivity/super-productivity): `Project.folderId?: string | null`, and `addProject`/`updateProject` both take `Partial<Project>`, forwarded untouched by `plugin/plugin.js` (`addProject`/`updateProject` cases). A `ProjectFolder` type exists upstream but no `PluginApi` method returns folder data (super-productivity/super-productivity#9600) — folder IDs are opaque to this server.

## Goals / Non-Goals

**Goals:**
- Let `create_project` and `update_project` set a project's `folderId`.
- Make the folder-ID-discovery limitation explicit in both tool descriptions so a client doesn't assume it can look folders up.

**Non-Goals:**
- Listing or resolving folders (blocked upstream, no plugin API surface).
- Creating/renaming/deleting folders.

## Decisions

- **Param name `folder_id` (snake_case), mapped to `data.folderId`**: matches existing convention in this file (`project_id`, `color` → `theme.primary`).
- **`folder_id` typed `string | null`, not just `string`**: mirrors upstream `Project.folderId?: string | null` exactly. Three states carried through: omitted → not included in `data`, so `updateProject` leaves the field untouched; `null` → `data.folderId = null`, clearing the assignment (matches how `updateProject` applies `Partial<Project>`); non-empty string → sets it. `create_project` accepts the same shape for symmetry, though `null` there is a no-op equivalent to omitting it (a new project has no folder either way).
- **Empty/whitespace-only string is an error, not a clear signal**: with `null` already meaning "clear," an empty string would be a second, redundant way to say the same thing — rejecting it (same pattern as `title`/`project_id`) avoids that ambiguity.
- **No format/existence validation on a non-empty `folder_id`**: passed through as an opaque string, let the plugin API reject unknown IDs. Consistent with existing treatment of `project_id`/`color`.
- **`get_projects` unchanged**: it already returns `res.result` raw from `getAllProjects()` (src/tools/projects.ts:26-33), so `folderId` surfaces with no code change.

## Risks / Trade-offs

- [Client passes a stale/invalid `folder_id`] → plugin API call fails or silently no-ops (upstream behavior, out of our control); the caveat in the tool description sets expectations that IDs come from the UI, not from this server.
