## Context

SP's Habit Tracker is internally the `SimpleCounter` NgRx feature (`SimpleCounterType`: `ClickCounter`, `StopWatch`, `RepeatedCountdownReminder`). Its `PluginAPI` surface (SP source, `src/app/plugins/plugin-api.ts` / `plugin-bridge.service.ts`, added in commit `3d4843ddf`, 2025-11-07) exposes:

- `getAllSimpleCounters()`, `getSimpleCounter(id)` — read
- `updateSimpleCounter(id, partial)` — patch any field, including replacing `countOnDay` wholesale
- `setSimpleCounterDate(id, date, value)` / `setSimpleCounterToday(id, value)` — absolute-set a day's value (read-modify-write against `countOnDay`, `YYYY-MM-DD` validated internally)
- `setSimpleCounterEnabled(id, bool)`, `deleteSimpleCounter(id)`
- `toggleSimpleCounter(id)` — flips an `isOn` boolean only meaningful for `StopWatch` running-state; irrelevant to click-counter/habit completion (confirmed by reading SP's reducer: `toggleSimpleCounterCounter` only ever touches `isOn`, never `countOnDay`)
- No native create call. SP's own `setCounter(id, value)` bridge method (used by SP's own plugins) creates-if-absent by dispatching `upsertSimpleCounter` with default fields when `getSimpleCounter(id)` returns nothing.

The streak length itself is never persisted — SP computes it on the fly client-side (`get-simple-counter-streak-duration.ts`) from `countOnDay` + `streakMinValue` + `streakMode` (`specific-days` using a weekday bitmap, or `weekly-frequency` using a target count per week). There is no `PluginAPI` method that returns a precomputed streak.

This project's existing tools (`src/tools/tasks.ts`, `tags.ts`, `projects.ts`) follow one shape: Zod schema → `sendCommand(dirs, action, data)` → plugin-side `case` in `executeCommand`'s switch → `PluginAPI` call → response. `plugin/plugin.js` already has precedent for read-modify-write patterns guarded against races within a single poll tick (`addTagToTask`, `removeTagFromTask`, `startTask`) and for converting an entity-map app-state slice to an array for MCP consumers (`getTaskRepeatCfgs`).

## Goals / Non-Goals

**Goals:**
- Full CRUD + check-off + backfill for habit-shaped `SimpleCounter` entries, matching the tool depth already given to tasks/tags/projects.
- Correct semantics for "check off a habit": increment, not toggle — matching what the SP UI itself does on click, not what the superficially-named `toggleSimpleCounter` method suggests.
- Computed streak returned on read, so a client doesn't need to reimplement SP's streak algorithm.

**Non-Goals:**
- Managing `StopWatch` or `RepeatedCountdownReminder` type entries — different feature, different interaction model (timers, reminders), even though they live in the same `SimpleCounter` store and share some `PluginAPI` methods.
- Reordering habits (`updateOrder` exists in SP but has no obvious MCP use case yet; can be added later as its own requirement if asked for).
- Editing history in bulk (e.g. "set the last 7 days at once") — `set_habit_value` is single-day; bulk backfill can compose it client-side.

## Decisions

**Streak computed server-side (TypeScript), not in `plugin.js`.**
`get-simple-counter-streak-duration.ts` is ~140 lines of date arithmetic. Porting it into `src/tools/habit-streak.ts` as a pure function keeps it unit-testable with vitest fixtures (matching this project's `tests/unit/tools/` convention) without needing a live SP instance, and keeps `plugin.js` — which has no test harness — as thin as possible. `get_habits`' handler in `src/tools/habits.ts` calls this function per habit after `getAllHabits` returns raw data. Alternative considered: compute streak in `plugin.js` via `PluginAPI.executeNodeScript`, rejected because it's untestable in isolation and duplicates logic that's easier to keep correct as reviewable TS.

**`check_habit` gets its own `case 'checkHabit'`, but no new `PluginAPI` surface.**
It's a separate plugin-side branch from `set_habit_value`'s `case 'setHabitValue'` (different validation, different semantics — increment vs. absolute-set), but both ultimately call `setSimpleCounterDate`. `checkHabit`'s handler reads the current day value via `getSimpleCounter` first, then calls `setSimpleCounterDate(id, date, current + 1)` — a read-modify-write within one `executeCommand` invocation, same pattern as `addTagToTask`.

**`create_habit` is upsert-then-configure, not a single call.**
There's no `addSimpleCounter`. Sequence: (1) call `setSimpleCounterDate(freshId, today, 0)` — since the counter doesn't exist yet, SP's underlying `setCounter`-equivalent creates it with defaults (title = id, `type: ClickCounter`, `isEnabled: true`); (2) immediately call `updateSimpleCounter(freshId, { title, icon, isTrackStreaks, streakMode, streakMinValue, streakWeekDays, streakWeeklyFrequency })` to apply the caller's actual config before anything else can observe the placeholder state. The plugin generates the id itself (matching how SP's own `addTag`/`addProject` return a generated id, not a caller-supplied one) rather than accepting a caller-supplied id, to avoid an id-collision failure mode when the "create" is really an upsert against arbitrary existing counters.

**Tools operate only on `type: ClickCounter` entries.**
`getAllHabits` (plugin-side) filters `PluginAPI.getAllSimpleCounters()` down to `type === 'ClickCounter'` before returning. `create_habit` always sets `type: 'ClickCounter'` — it's not a parameter. This keeps the MCP-facing "habit" concept aligned with what issue #91 actually asked for, and avoids the tool set silently letting an AI client corrupt someone's stopwatch or reminder configuration under a "habit" label.

**Capability detection via a feature probe, not a version string.**
`plugin.js` has no reliable way to read the SP semver at runtime beyond what's already exposed. The habit-tools handler checks `typeof PluginAPI.getAllSimpleCounters === 'function'` (and similarly for the other methods it calls) before dispatching, returning a dedicated error (`Habit management requires a newer version of Super Productivity.`) instead of letting a `TypeError: ... is not a function` bubble up from the plugin sandbox. This mirrors no existing pattern in the codebase exactly, but is the same idea as the existing `protocolVersion` check in `executeCommand`.

**`manifest.json`'s `minSupVersion` stays at `14.0.0`, unchanged.**
The full `SimpleCounter` `PluginAPI` methods this design needs shipped 2025-11-07, well after SP 14.0.0. Bumping `minSupVersion` to match would lock out existing users of every other tool (tasks/projects/tags) on older SP installs just to gate a handful of new habit tools. The capability probe above already turns "old SP, no habit support" into one clear error scoped to habit tools only — so the manifest floor is left alone and the version gap is handled entirely at runtime.

## Risks / Trade-offs

- **[Risk]** `PluginAPI.updateSimpleCounter` accepts `Partial<any>` in SP's implementation (typed as `any`, not the real `SimpleCounter` shape) → a malformed update could write an invalid `countOnDay` or streak config that SP's own UI doesn't validate against either. **Mitigation:** `src/tools/habits.ts`'s Zod schema validates shape before the command is ever sent (same defense-in-depth already used for `update_tag`/`update_task`).
- **[Risk]** The full-model `PluginAPI` methods this design depends on shipped 2025-11-07 — recent. Users on older SP builds will hit every habit tool failing. **Mitigation:** the capability-detection error above turns that into one clear message instead of N confusing ones.
- **[Trade-off]** Filtering to `ClickCounter` only in `plugin.js` means a user who's using `SimpleCounter` entries in an unconventional way (e.g. a `ClickCounter` they use as a plain tally, not a habit) will have it show up in `get_habits` too — the filter is by `type`, not by `isTrackStreaks`. Accepted: SP itself doesn't distinguish "habit" from "tally counter" beyond `type`, so this is the same granularity SP's own data model offers.
- **[Trade-off]** `create_habit` costs two round-trip `PluginAPI` calls (upsert then configure) instead of one atomic call. A crash between step 1 and 2 would leave a placeholder counter with the generated id and default title. Accepted as low-probability and self-correcting (a client can `update_habit` or `delete_habit` it); no native atomic create call exists to do better.
