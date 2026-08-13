## 1. IPC plumbing

- [x] 1.1 Extend `src/ipc/types.ts` `Command` with a `habitId?: string` field (parity with `tagId`/`taskId`/`projectId`; optional field + new actions only, so no `protocolVersion` bump per the constitution's versioning rule)

## 2. Plugin-side handlers (`plugin/plugin.js`)

- [x] 2.1 Add a capability check helper that verifies `PluginAPI.getAllSimpleCounters`, `getSimpleCounter`, `updateSimpleCounter`, `setSimpleCounterDate`, `deleteSimpleCounter` are all functions; return the "requires a newer version of Super Productivity" error when any is missing
- [x] 2.2 `case 'getAllHabits'`: call `PluginAPI.getAllSimpleCounters()`, filter to `type === 'ClickCounter'`, return the array
- [x] 2.3 `case 'addHabit'`: generate an id, call `setSimpleCounterDate(id, today, 0)` to create the placeholder, then `updateSimpleCounter(id, { title, ...streak config, type: 'ClickCounter' })`; return the generated id
- [x] 2.4 `case 'updateHabit'`: validate the habit exists via `getSimpleCounter(command.habitId)` (error if not found), then `updateSimpleCounter(command.habitId, command.data)`
- [x] 2.5 `case 'setHabitValue'`: validate the habit exists, validate `command.data.date` matches `YYYY-MM-DD`, call `setSimpleCounterDate(command.habitId, command.data.date, command.data.value)`
- [x] 2.6 `case 'checkHabit'`: validate the habit exists, read current value for `command.data.date` (default today) from `getSimpleCounter`, call `setSimpleCounterDate(command.habitId, date, currentValue + 1)`
- [x] 2.7 `case 'deleteHabit'`: validate the habit exists (error if not found), call `PluginAPI.deleteSimpleCounter(command.habitId)`

(Plugin-side code has no unit test harness — covered by the manual smoke test in section 7, per the constitution's test-pyramid carve-out for plugin behaviour.)

## 3. Streak calculation (`src/tools/habit-streak.ts`) — TDD

- [x] 3.1 Write failing unit tests in `tests/unit/tools/habit-streak.spec.ts` for specific-days mode: no streak config → 0, empty `countOnDay` → 0, a streak broken by a gap, a streak crossing a week boundary
- [x] 3.2 Port `getSimpleCounterStreakDuration`'s specific-days logic from SP's `get-simple-counter-streak-duration.ts` until 3.1 passes
- [x] 3.3 Write failing unit tests for weekly-frequency mode: current week already meets the target, current week doesn't meet it yet, a streak carrying over from a prior week, empty `countOnDay`
- [x] 3.4 Port `calculateWeeklyFrequencyStreak` and its helpers until 3.3 passes

## 4. MCP tools (`src/tools/habits.ts`) — TDD, test then implementation per tool

- [x] 4.1 Write failing tests for `create_habit` in `tests/unit/tools/habits.spec.ts`: minimal (title only), with specific-days streak config, with weekly-frequency streak config, missing title rejected
- [x] 4.2 Implement `create_habit` (Zod schema: `title` required; `icon`, `is_track_streaks`, `streak_mode`, `streak_min_value`, `streak_week_days`, `streak_weekly_frequency` optional) → `sendCommand(dirs, 'addHabit', { data })` → `{ habitId: res.result }`, until 4.1 passes
- [x] 4.3 Write failing tests for `get_habits`: returns all habits with a computed `streak` field, returns empty array when none exist
- [x] 4.4 Implement `get_habits` → `sendCommand(dirs, 'getAllHabits')` → map each raw habit through the ported streak function, until 4.3 passes
- [x] 4.5 Write failing tests for `update_habit`: partial update leaves other fields untouched, not-found habit rejected
- [x] 4.6 Implement `update_habit` (Zod schema: `habit_id` required, all config fields optional) → `sendCommand(dirs, 'updateHabit', { habitId, data })`, until 4.5 passes
- [x] 4.7 Write failing tests for `check_habit`: first check-off of the day records 1, repeated check-off increments, not-found habit rejected
- [x] 4.8 Implement `check_habit` (Zod schema: `habit_id` required, `date` optional `YYYY-MM-DD`) → `sendCommand(dirs, 'checkHabit', { habitId, data: { date } })`, until 4.7 passes
- [x] 4.9 Write failing tests for `set_habit_value`: backfill a past date, correct today's value to 0, invalid date format rejected
- [x] 4.10 Implement `set_habit_value` (Zod schema: `habit_id`, `value` required; `date` optional, default today) → `sendCommand(dirs, 'setHabitValue', { habitId, data: { date, value } })`, until 4.9 passes
- [x] 4.11 Write failing tests for `delete_habit`: successful delete, not-found habit rejected
- [x] 4.12 Implement `delete_habit` (Zod schema: `habit_id` required) → `sendCommand(dirs, 'deleteHabit', { habitId })`, until 4.11 passes
- [x] 4.13 Export `registerHabitTools(server, dirs)` and call it from `src/server.ts` alongside the other `register*Tools` calls

## 5. Integration tests

- [x] 5.1 Integration test: full command → response round-trip for each habit action (`getAllHabits`, `addHabit`, `updateHabit`, `checkHabit`, `setHabitValue`, `deleteHabit`) against a mocked filesystem (temp `plugin_commands`/`plugin_responses` dirs), per the constitution's IPC integration-test tier — not a unit mock of `sendCommand`
- [x] 5.2 Test the capability-detection error path: mocked plugin response for missing `PluginAPI` methods surfaces as a clear MCP error result, not a crash

## 6. Docs

- [x] 6.1 Update README.md with the 6 new habit tools (names, inputs, examples), matching the existing tool documentation format, per the constitution's "updated README if tool surface changes" requirement

## 7. Verification

- [x] 7.1 `npm run typecheck`
- [x] 7.2 `npm test`
- [x] 7.3 `npm run lint`
- [x] 7.4 `npm run build` (confirms `dist/plugin.zip` picks up the updated `plugin.js`)
- [ ] 7.5 Manual smoke test against a running SP instance (>= the build containing commit `3d4843ddf`): create a habit, check it off twice, list habits and confirm the value and streak, backfill a past date, update its title, delete it
