# Design

## Context

See proposal.md for motivation. `deadline_day` (archived change `add-deadline-day-and-strict-schemas`) is the closest precedent: a task field that `PluginAPI.addTask()` drops, written via a follow-up `PluginAPI.updateTask`.

Current shape in `src/tools/tasks.ts`: shared raw-shape schemas feed strict `z.object({...}).strict()` instances; handlers map snake_case params to camelCase `data` keys. `plugin/plugin.js` `addTask` already does the follow-up pattern for `deadlineDay`; `createTaskWithSubtasks` builds explicit `addTask` payloads with no follow-up at all.

## Goals / Non-Goals

**Goals:**
- One shared `priority` schema reused by all four tools, so the value domain cannot drift.
- Create paths persist priority for real, not just pass it to a call that drops it.

**Non-Goals:**
- `p1`/`p2`/`p3` title short syntax (would mangle titles such as "Fix bug p2"; explicit param is unambiguous).
- Accepting SP's `'high'|'medium'|'low'` string forms. Reads may still return them; writes use numbers only.
- Priority filter on `get_tasks`.

## Decisions

**Schema: `z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable().optional()`**, defined once and spread into each tool. Alternatives: `z.number().int().min(1).max(3)` (same domain, weaker JSON-schema hint for clients); also accepting strings (two representations for one value, more tests, no client need).

**`null` clears, omitted leaves untouched.** Handlers use `priority !== undefined` and map straight to `data.priority`. This differs from `deadline_day`'s `""`-clears convention because the field is numeric; `null` is the natural clear value and matches `planned_at`/`due_with_time` in the same file.

**Plugin create follow-up only when priority is a number.** `addTask` and each subtask in `createTaskWithSubtasks` call `updateTask(id, { priority })` only if `priority` is `1|2|3`. `null` or absent means "no priority" already, so the extra round trip is skipped. Alternative: always follow up (simpler, wasted call per task).

**Validation is whole-call; creation failures are not rolled back.** Strict zod validation runs before any command is sent, so an invalid `priority` in one bulk item or subtask rejects the entire call (see spec). If a follow-up `updateTask` fails after a task was created, `createTaskWithSubtasks` returns an error naming the failing task and the already-created ids and leaves them in place. Alternative: roll back via `deleteTask` (available in the plugin) — rejected because a failed rollback would add a second failure mode, and the caller can delete or fix the reported ids.

**Update and bulk need no plugin change.** `updateTask` and `bulkUpdateTasks` forward `data` unchanged.

**`createTaskWithSubtasks` plugin payload gains `priority` for parent and subtasks** as a field in the command data, applied via follow-up, not via `addTask`.

## Risks / Trade-offs

- [SP may reject or normalise `priority: null` or the numeric value in `updateTask`] → Verify against live SP before archive (tasks group 5); unit tests with a stubbed `PluginAPI` cannot catch this, as the deadline change showed.
- [Mocked tests miss `addTask` dropping the field] → Plugin test asserts the follow-up `updateTask` call, like the existing `deadlineDay` test.
- [Strict schemas: any client already sending `priority` was rejected before, now accepted] → No migration needed; this only widens accepted input.

## Open Questions

- Does SP's `updateTask` persist `priority: null` as cleared (vs. leaving a stale value)? Answerable during live verification; if it fails, the clear path switches to `undefined`/delete semantics without changing the spec.
