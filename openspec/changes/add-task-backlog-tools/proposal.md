## Why

A Super Productivity project has two task lists: the regular list (`taskIds`) and the backlog (`backlogTaskIds`). The MCP server cannot move a task between them. Issue-provider tasks (e.g. Asana) auto-import into the backlog, so an assistant that ranks the week's priorities cannot promote them. Worse, `reorder_tasks` with a backlog task ID adds it to `taskIds` without removing it from `backlogTaskIds`, leaving the task in both lists. Tracked as GitHub issue #139.

## What Changes

- New tool `move_tasks_backlog`: moves one or more top-level tasks into a project's backlog or back to its regular list (`destination: 'backlog' | 'regular'`). Covers the issue's `move_task_to_backlog` / `move_task_out_of_backlog` plus bulk variants in one tool.
- New plugin command `moveTasksBacklog`: groups tasks by project, validates the whole batch, then rewrites `taskIds` and `backlogTaskIds` with one `PluginAPI.updateProject` call per project.
- Refuse moves in projects where `isEnableBacklog` is false (the UI hides such a backlog, so the task would disappear).
- `reorder_tasks` (plugin side): reject task IDs that are in the project's `backlogTaskIds`, instead of creating a duplicate.
- Plugin version bump 1.7.0 → 1.8.0.

## Capabilities

### New Capabilities
- `task-backlog`: moving tasks between a project's regular list and its backlog, and keeping task reordering from corrupting the two lists.

### Modified Capabilities
(none — no existing spec covers `reorder_tasks`; its new guard is specified under `task-backlog`)

## Impact

- Code: `src/tools/tasks.ts` (new tool), `plugin/plugin.js` (new `moveTasksBacklog` case, `reorderTasks` guard, `PLUGIN_VERSION`), `plugin/manifest.json` (version).
- Tests: `tests/unit/tools/tasks.test.ts`; plugin version test follows the bump.
- No breaking changes. Requires the updated plugin (1.8.0); an older plugin returns an unknown-command error.
