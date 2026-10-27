## Context

See proposal.md - Why. Findings from SP source (super-productivity/super-productivity):
- `PluginAPI.updateProject(id, Partial<Project>)` is a plain `projectService.update`; `taskIds` and `backlogTaskIds` pass through (typia `Partial<ProjectCopy>` assert only).
- Bridge `reorderTasks` checks only `task.projectId === contextId`, then sets `project.taskIds = taskIds`. A backlog task passes and is duplicated. Source comment: "assumes all tasks are in the regular list, not backlog".
- SP has reducer actions `moveProjectTaskToBacklogList` / `moveProjectTaskToRegularList` (atomic, anchor-based), reachable only via `dispatchAction`, whose permissions and payload are unverified.
- Prior art: ipryseski/SP-MCP#6 (read-modify-write via `updateProject`) and #7 (refuse when `isEnableBacklog` is false, else the task becomes invisible).

## Goals / Non-Goals

**Goals:**
- Move tasks to and from a project's backlog, singly or in bulk.
- Never leave a task in both lists or in neither.
- Stop `reorder_tasks` from duplicating backlog tasks.

**Non-Goals:**
- Ordering within the backlog or choosing an insert position (append only).
- Reordering backlog tasks.
- Using `dispatchAction` (possible later upgrade for atomicity and anchors).

## Decisions

- **One bulk tool `move_tasks_backlog({ task_ids, destination })`** instead of two single-task tools: one read and one write per project, smaller race window, fewer tools. Departs from the issue's naming; noted on the issue.
- **Read-modify-write via `updateProject`**: proven by prior art, no unverified APIs. Re-read `getAllProjects()` right before writing to keep the race with SP-side changes (e.g. issue-provider imports) small. Not atomic; accepted.
- **Validate whole batch before any write**: a failing ID aborts with no writes (same rule as `reorderTasks`). Checks: task exists; top-level (no `parentId`); has `projectId`; project exists; `isEnableBacklog` true; task is in `taskIds` or `backlogTaskIds` of its project.
- **Idempotent**: task already in the destination list is a successful no-op, reported in the result as unchanged.
- **Destination `backlog`**: remove from `taskIds`, append to `backlogTaskIds`. **Destination `regular`**: remove from `backlogTaskIds`, append to `taskIds`.
- **`isEnableBacklog` false is an error for both directions**: a no-op would hide the problem from the assistant.
- **`reorderTasks` guard**: after existing validation, fetch the project and reject any ID in `backlogTaskIds` with a message pointing to `move_tasks_backlog`. Applies only to `contextType: 'project'`.
- **Result shape**: `{ success: true, moved: string[], unchanged: string[] }`.

## Risks / Trade-offs

- [Concurrent SP write between read and `updateProject`] → overwrites that change; mitigated by re-reading immediately before write and writing once per project.
- [`updateProject` bypasses SP's move reducer] → any side state the reducer maintains could drift; verify manually against a running SP before archive.
- [Older plugin lacks the command] → tool returns the plugin's unknown-command error; version bump signals the requirement.
