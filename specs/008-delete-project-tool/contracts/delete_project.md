# MCP Tool Contract: `delete_project`

## Description

Permanently delete a project and all tasks it contains in Super Productivity. Mirrors `delete_task`'s calling convention and error style, applied to projects.

Per spec FR-008, the tool's registered `description` string must state plainly that this also deletes the project's tasks, so a calling assistant does not assume a "detach tasks first" semantics.

## Input Schema

| Parameter | Type | Required | Description |
|---|---|---|---|
| `project_id` | string | yes | ID of the project to delete, as returned by `get_projects` or `create_project`. |

Schema follows the project's existing `.strict()` convention (see `src/tools/projects.ts`, `src/tools/tasks.ts`): an unrecognized parameter MUST fail validation rather than be silently dropped.

```ts
const deleteProjectShape = {
  project_id: z.string().describe('Project ID to delete. Also deletes all tasks in the project.'),
};
export const deleteProjectSchema = z.object(deleteProjectShape).strict();
```

## Behavior / Error Contract

| Scenario | Result |
|---|---|
| `project_id` missing, empty, or whitespace-only | `errorResult('project_id is required')` — rejected before any IPC call, matching `delete_task`'s existing `task_id` validation |
| `project_id` does not match any existing project | IPC error surfaces as `errorResult('Project not found: <id>')` (FR-005) |
| `project_id` is `'INBOX_PROJECT'` (the Inbox) | IPC error surfaces as `errorResult('The Inbox project cannot be deleted.')` (FR-004) — no data is deleted |
| `project_id` is valid, exists, is not the Inbox | Project and all its tasks are deleted; tool returns `okResult({ success: true })` (FR-003, FR-006) |
| SP plugin is not running / unreachable | Standard "Super Productivity is not responding..." timeout error (Constitution IX) — unchanged, no new handling needed |

## Output Shape

Success:
```json
{ "success": true }
```

Error (example):
```json
{ "error": "Project not found: proj-abc123" }
```
(Shape matches the existing `okResult`/`errorResult` helpers in `src/tools/result.ts` — no new result-shaping code is introduced.)

## Non-Goals (explicitly out of scope per spec Assumptions)

- No bulk/multi-project variant (no `bulk_delete_projects`).
- No confirmation or dry-run flag on the tool itself — the calling assistant owns confirming destructive intent with its user, same as `delete_task` today.
- No new "preview what will be destroyed" tool — `get_tasks` filtered by `project_id` already covers this (clarification, 2026-10-14).
- No runtime `PluginAPI.deleteProject` capability probe — the `minSupVersion` manifest bump is the sole version gate (clarification, 2026-10-14).
