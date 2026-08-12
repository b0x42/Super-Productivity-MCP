## Why

Super Productivity's Habit Tracker (internally the `SimpleCounter` feature) has no MCP exposure — `src/tools/` covers tasks, projects, tags, and notifications, but nothing lets an AI assistant read or manage habits. Users tracking habits alongside tasks (e.g. via issue #91) have no way to check habit status or log a check-off through the MCP server. SP's `PluginAPI` already exposes a full read/update/toggle/delete surface for this data (added 2025-11-07), so the gap is purely in this project, not upstream.

## What Changes

- New `create_habit`, `get_habits`, `update_habit`, `check_habit`, `set_habit_value`, and `delete_habit` MCP tools, following the existing `tools/tasks.ts` / `tools/tags.ts` pattern (Zod input schema → `sendCommand` → `okResult`/`errorResult`).
- New `plugin/plugin.js` command handlers wired to `PluginAPI.getAllSimpleCounters`, `getSimpleCounter`, `updateSimpleCounter`, `deleteSimpleCounter`, and `setSimpleCounterDate`. There is no native "create" call — `create_habit` is implemented as upsert-then-configure (`setSimpleCounterDate` on a fresh id to force creation, then `updateSimpleCounter` to set title/streak config), matching how SP's own `setCounter` bridge method creates new counters.
- **Correction from initial exploration**: `toggleSimpleCounter` only flips an `isOn` flag used for `StopWatch` running-state — it is unrelated to habit check-off. SP's actual Habit Tracker UI marks a day done by incrementing `countOnDay[date]` (via `setCounterForDate`). `check_habit` therefore reads the current day value and writes `current + 1` through `setSimpleCounterDate`, not `toggleSimpleCounter`.
- Server-side streak computation ported from SP's `get-simple-counter-streak-duration.ts` (specific-days and weekly-frequency modes), since the streak count isn't stored — it's derived client-side in SP from `countOnDay` history. `get_habits` returns this computed streak alongside raw fields.
- Tools are scoped to habit-shaped counters (`type: ClickCounter` with streak tracking), not the full `SimpleCounter` entity space. `StopWatch` and `RepeatedCountdownReminder` types are a different SP feature (time tracking / reminders) that happen to share the same underlying store; managing those is out of scope even though the same `PluginAPI` methods touch them.
- Capability probe: `get_habits` (or a dedicated check) must detect and report a clear error when the connected SP instance predates the simple-counter `PluginAPI` methods, rather than failing with an opaque "not a function" from the plugin sandbox.

## Capabilities

### New Capabilities
- `habits`: create, read, update, check off (increment today's or a given day's value), backfill/correct a day's value, and delete SP habits (SimpleCounter/ClickCounter entities with streak tracking), including computed streak counts.

### Modified Capabilities
(none — no existing capability's requirements change)

## Governance

Traceable to Principle IV (*"The server MUST expose tools for the full set of operations supported by the SP Plugin API"*): habits are a native SP entity type exposed by `PluginAPI` on the same footing as tasks/projects/tags, so extending tool coverage to them follows the existing principle rather than requiring a new one. Principle VI's "core tool set" (task/project/tag/notification CRUD) describes the v1 starting scope, not a permanent ceiling — it does not prohibit additive tool growth for other native SP entities. No constitution amendment needed.

## Impact

- `src/tools/habits.ts` (new) — registered in `src/server.ts` alongside the other tool modules.
- `src/tools/habit-streak.ts` (new, or colocated) — ported streak calculation, pure function, unit-testable.
- `plugin/plugin.js` — new `case` branches in `executeCommand`'s switch for `getAllHabits`, `addHabit`, `updateHabit`, `setHabitValue`, `checkHabit`, `deleteHabit`. `checkHabit` is its own branch (not a reuse of `setHabitValue`'s), but calls the same underlying `PluginAPI.setSimpleCounterDate` after computing `current + 1`.
- `src/ipc/types.ts` — extend `Command` with a `habitId?: string` field, for parity with `tagId`/`taskId`/`projectId`.
- `tests/unit/tools/` — new `habits.spec.ts`; streak calculation gets its own unit tests against known `countOnDay` fixtures.
- No changes to existing tools, no breaking changes.
