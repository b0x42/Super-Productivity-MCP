# Quickstart: Delete Project Tool

Validation guide for the `delete_project` MCP tool. Assumes the project's standard dev setup (see root `README.md`/`AGENTS.md`) is already working.

## Prerequisites

- `npm install` already run at the repo root.
- Super Productivity >= 19.0.1 running locally with the dev build of this plugin installed, OR rely on the unit/integration test suite below if no live SP instance is available (the IPC layer is designed to be testable without one — Constitution "Development Workflow").

## Build

```bash
npm run build        # dist/index.js + dist/plugin.zip
npm run typecheck     # tsc --noEmit — do NOT use npx tsc directly
npm run lint
```

## Automated validation (no running SP instance required)

```bash
npm test              # vitest run — includes the new delete_project schema/handler tests
```

Expected: `tests/unit/tools/projects.test.ts` includes new cases asserting:
- `delete_project` with an empty/whitespace `project_id` is rejected before any `sendCommand` call.
- `delete_project` with a valid `project_id` sends a `deleteProject` command with `{ projectId: <id> }` and returns `{ success: true }` on a `null`-result success response.
- `delete_project` surfaces the plugin's `error` string unchanged (not-found and Inbox-refusal messages pass through verbatim).
- `deleteProjectSchema` rejects an unrecognized parameter (consistent with the `.strict()` convention used by every other schema in the file).

## Manual end-to-end validation (requires a running SP instance)

1. Install `dist/plugin.zip` into Super Productivity (Settings → Plugins → upload) on an instance running >= 19.0.1.
2. Point an MCP client at `dist/index.js` (see root README's "Option B — From source" setup).
3. Run `check_connection` — confirm `pluginVersion` matches `plugin/manifest.json`'s bumped version and the connection succeeds.
4. Call `create_project` with `{"title": "Quickstart Delete Test"}` — note the returned `projectId`.
5. Call `create_task` with `{"title": "Throwaway task", "project_id": "<projectId>"}`.
6. Call `delete_project` with `{"project_id": "<projectId>"}` — expect `{ "success": true }`.
7. Call `get_projects` — confirm the deleted project is absent.
8. Call `get_tasks` with `{"include_done": true, "include_archived": true}` — confirm the throwaway task is absent.
9. Call `delete_project` again with the same (now-deleted) `project_id` — expect an error, not a silent success (Edge Case: repeat deletion).
10. Call `delete_project` with `{"project_id": "INBOX_PROJECT"}` — expect the Inbox-refusal error, and confirm in the SP UI that the Inbox and its tasks are untouched.
11. Call `delete_project` with `{"project_id": "does-not-exist"}` — expect a "Project not found" error.

## Expected Outcome

All steps above complete with the exact success/error shapes documented in [contracts/delete_project.md](./contracts/delete_project.md), and no step 9–11 case leaves Super Productivity in a state inconsistent with its own native "Delete project" UI action (per spec SC-002, SC-003, SC-004).
