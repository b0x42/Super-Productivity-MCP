## Why

GitHub issue #101: `update_task` (and `create_task`) cannot set a task's deadline. SP stores `deadlineDay` separately from `dueDay`/`plannedAt`, and `get_tasks` already reads it via `fields`, but no tool can write it. Worse, passing an unsupported key like `deadline_day` today returns success and silently writes nothing, because every tool's Zod object schema strips unrecognized keys by default — a caller has no way to detect the typo/gap short of noticing the field never changed.

## What Changes

- Add a `deadline_day` parameter (ISO date string, empty string clears) to `create_task`, `update_task`, and `bulk_update_tasks`, mapped to SP's `deadlineDay` field using the same `value || null` clearing convention already used for `due_day`.
- `create_task` is **not** getting `due_day`/`planned_at` support in this change — that gap is unrelated to issue #101 and stays out of scope.
- **BREAKING**: switch every tool's `inputSchema` (in `tasks.ts`, `projects.ts`, `tags.ts`, `habits.ts`, `notifications.ts`, `diagnostics.ts`) from Zod's default "strip unknown keys" behavior to `.strict()`, so a call with an unrecognized parameter now fails validation instead of silently succeeding with that key ignored. This includes nested array-item schemas — `bulk_update_tasks`'s `updates[]` items and `create_task`'s `subtasks[]` items (tasks.ts:421) — not just each tool's top-level schema, since an unrecognized key inside one of those nested items is the same silent-drop bug this change exists to close. Any existing caller that (knowingly or not) sends extra/misspelled keys will start seeing errors where it previously saw silent no-ops.
- The resulting validation error must name the offending unrecognized parameter, per the project's constitution requirement that error responses be actionable rather than generic.
- Add unit tests covering: `deadlineDay` round-trip and empty-string clearing on the three affected tools (including a partial-failure case for `bulk_update_tasks`), and unknown-key rejection (top-level and nested) across all registered tools.

## Capabilities

### New Capabilities
- `task-deadline`: `deadline_day` parameter support on `create_task`, `update_task`, and `bulk_update_tasks`, mirroring the existing `due_day` convention. (Named narrowly, not `tasks`, since `openspec/specs/` has no existing `tasks` capability yet — a delta this small should not become the entire archived "tasks" spec and imply it documents the full task tool surface.)
- `mcp-tool-input-validation`: every registered MCP tool rejects calls containing parameters not declared in its schema (including nested array-item schemas), instead of silently discarding them, with an actionable error identifying the offending parameter.

### Modified Capabilities
(none — no existing capability specs exist under `openspec/specs/` yet to modify)

## Impact

- `src/tools/tasks.ts`: schemas and handlers for `create_task`, `update_task`, `bulk_update_tasks`.
- `src/tools/projects.ts`, `src/tools/tags.ts`, `src/tools/habits.ts`, `src/tools/notifications.ts`, `src/tools/diagnostics.ts`: `inputSchema` registration switches to strict validation (no field changes otherwise).
- `tests/unit/tools/*`: new/updated test cases per file above.
- Plugin (`plugin/plugin.js`) requires no change — `updateTask`/`addTask` command handlers already pass `command.data` through to `PluginAPI` verbatim.
- Any MCP client currently sending unrecognized parameters to any tool will start receiving validation errors (breaking, but closes a silent-failure bug class per issue #101's "nice to have" request).
