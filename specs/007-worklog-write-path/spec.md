# Feature Specification: Worklog Write Path

**Feature Branch**: `007-worklog-write-path`
**Created**: 2026-09-01
**Status**: Draft
**Input**: Make the per-day worklog the deliberate, only writable representation of time spent — multi-day `log_time`, documented reads, and removal of the bare `timeSpent` write that can produce a state SP's own model forbids.

## Context

In Super Productivity, `timeSpentOnDay` is authoritative and `timeSpent` is always
derived from it. Three independent paths in SP's source agree:

| Path | Writes |
|------|--------|
| Task reducer (`addTimeSpent`, `roundTimeSpentForDay`, `addSubTask`) | `timeSpentOnDay[date]`, then `timeSpent = calcTotalTimeSpent(...)` |
| Time-estimate dialog (user edits "time spent") | `timeSpentOnDay: { ...copy, [getDbDateStr(date)]: value }` |
| Short syntax `1h/2h` | `timeSpentOnDay: { ...task.timeSpentOnDay, [getDbDateStr()]: ms }` |

SP has no path that sets `timeSpent` directly. Parents are recomputed via
`reCalcTimeSpentForParentIfParent`.

This repo has two paths that do set it directly — `update_task`
(`src/tools/tasks.ts:317`) and `bulk_update_tasks` (`src/tools/tasks.ts:448`) —
both writing through the generic `PluginAPI.updateTask`, which bypasses SP's
recompute. They can produce a task where `timeSpent ≠ sum(timeSpentOnDay)`: a
state SP cannot represent and will silently discard the next time anything
touches that task's time.

Reading the map already works, but by accident rather than design: the `fields`
filter is `if (f in t)`, so `timeSpentOnDay` passes through while appearing in no
documentation.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Logging Several Days at Once (Priority: P1)

`log_time` accepts a list of day/duration pairs, so backfilling or correcting a
stretch of history is one call rather than N — and without ever handing the
caller a whole map to edit and send back.

**Why this priority**: The capability gap. Single-day logging already works;
multi-day is what a whole-map write on `update_task` would have bought, minus
the race.

**Independent Test**: Log three days in one call, read the task back, verify all
three days and the recomputed total.

**Acceptance Scenarios**:

1. **Given** `entries: [{date, duration}, ...]`, **When** called, **Then** each day is applied and the total is recomputed once from the final map
2. **Given** both `duration` and `entries`, **When** called, **Then** an error is returned — they are mutually exclusive
3. **Given** neither `duration` nor `entries`, **When** called, **Then** an error is returned
4. **Given** `entries` containing the same date twice, **When** called, **Then** an error is returned rather than one entry silently winning
5. **Given** `entries: []`, **When** called, **Then** an error is returned — a call that writes nothing is a mistake, not a no-op
6. **Given** `mode`, **When** called with `entries`, **Then** it applies to every entry
7. **Given** any entry with an invalid duration or date, **When** called, **Then** the whole call fails and nothing is written
8. **Given** the task has a parent, **When** several days are logged, **Then** the parent receives the delta for each affected day in a single update

---

### User Story 2 - Reading the Worklog on Purpose (Priority: P2)

The per-day map becomes a documented, deliberate part of the read surface
instead of something that happens to work.

**Why this priority**: It already functions; this makes it dependable.

**Independent Test**: Request `fields: ["timeSpentOnDay"]` and read the resource
summary; both return the map.

**Acceptance Scenarios**:

1. **Given** the README and spec 005's valid-field list, **When** read, **Then** `timeSpentOnDay` appears in both
2. **Given** the MCP task resource summary, **When** fetched, **Then** it includes `timeSpentOnDay` alongside `timeSpent`
3. **Given** an existing `fields: ["timeSpentOnDay"]` call, **When** made, **Then** its behaviour is unchanged

---

### User Story 3 - Removing the Write SP Cannot Represent (Priority: P3)

`time_spent` is removed from `update_task` and `bulk_update_tasks`. The total
stays fully readable; it is simply no longer settable, because SP derives it.

**Why this priority**: Stops new divergent tasks. Breaking, so it is sequenced
after the replacement capability exists.

**Independent Test**: Call `update_task` with `time_spent` and confirm a
validation error naming `log_time`.

**Acceptance Scenarios**:

1. **Given** `update_task` with `time_spent`, **When** called, **Then** validation fails (schemas are `.strict()`) and the tool description directs the caller to `log_time`
2. **Given** a `bulk_update_tasks` item with `time_spent`, **When** called, **Then** validation fails
3. **Given** `time_estimate`, **When** set through either tool, **Then** it still works — SP stores `timeEstimate` directly, so it is a genuine standalone field
4. **Given** any other `update_task` field, **When** set, **Then** behaviour is unchanged

---

### Edge Cases

- A task whose `timeSpent` already diverges from its map (such as one imported from another source): `log_time` recomputes from the map, matching SP. The unattributed total is not preserved — SP would overwrite it at the next timer tick regardless — but the response reports what it was, so the change is visible rather than silent (FR-012).
- SP's timer is running on a day being logged: `log_time` sends durations, not a map, and the read-modify-write happens inside the plugin within one command. The exposure is one command, the same as SP's own writes — not the length of an agent's turn, which a whole-map write would have been.
- Logging `0m` in `set` mode for a day removes that day's entry, as today.
- A date in the future or far past is accepted; SP's own dialog permits arbitrary dates and the worklog is a record, not a schedule.

## Requirements *(mandatory)*

### Functional Requirements — Multi-day logging

- **FR-001**: `log_time` MUST accept `entries: [{ date, duration }, ...]` as an alternative to `duration`/`date`
- **FR-002**: `duration` and `entries` MUST be mutually exclusive; supplying both, or neither, is an error
- **FR-003**: `entries` MUST reject duplicate dates
- **FR-003a**: Each entry's `date` MUST be ISO `YYYY-MM-DD` and its `duration` MUST be SP short syntax, validated identically to the single-day form — the multi-day path introduces no second set of parsing rules
- **FR-003b**: `entries` MUST be capped at 100, matching the existing bulk tools (`bulk_update_tasks`, `bulk_complete_tasks`)
- **FR-004**: `entries` MUST reject an empty array
- **FR-005**: Every entry MUST be validated before any write; one invalid entry fails the call with nothing written
- **FR-006**: `mode` MUST apply to every entry in the call
- **FR-007**: `timeSpent` MUST be recomputed once from the final map, not once per entry
- **FR-008**: A parent task MUST receive the delta for every affected day in a single update
- **FR-009**: The response MUST return the resulting map and total

### Functional Requirements — Reads

- **FR-010**: `timeSpentOnDay` MUST be documented as a valid `fields` value in the README and in spec 005's valid-field list
- **FR-011**: The MCP task resource summary MUST include `timeSpentOnDay`
- **FR-012**: When the task's `timeSpent` differed from the sum of its map before the write, the response MUST report the previous total, so a corrected divergence is visible to the caller

### Functional Requirements — Removal

- **FR-013**: `time_spent` MUST be removed from the `update_task` schema
- **FR-014**: `time_spent` MUST be removed from the `bulk_update_tasks` item schema
- **FR-015**: Both tool descriptions MUST direct callers to `log_time` for writing time
- **FR-016**: `time_estimate` MUST remain writable through both tools

### Key Entities

- **WorklogEntry**: `{ date, duration }` — one day's contribution in a multi-day call. `date` is ISO `YYYY-MM-DD`; `duration` is SP short syntax (`2h`, `45m`, `1h30m`). Unlike the single-day form, `date` is required — a list of entries has no sensible "default to today"
- **Per-day map** (`timeSpentOnDay`): the authoritative record; the total is derived from it

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Backfilling seven days takes one `log_time` call
- **SC-002**: No tool in this server can produce a task where `timeSpent ≠ sum(timeSpentOnDay)`
- **SC-003**: Existing single-day `log_time` calls behave identically — the multi-day form is additive
- **SC-004**: The caller never holds a `timeSpentOnDay` map between a read and a write, so no agent-length window exists in which SP's timer can be clobbered

## Assumptions

- This is a breaking change to `update_task` and `bulk_update_tasks`, warranting a minor version bump. Because the schemas are `.strict()`, a caller passing `time_spent` gets an immediate validation error rather than a silent behaviour change — a loud failure with a message pointing at `log_time`.
- Divergent totals are not preserved. SP discards them at the next write to the task's time, so preserving one would manufacture a state SP's model forbids and then lose it anyway. FR-012 makes the correction visible instead.
- `applyDayTime` in `plugin/plugin.js` generalizes from one day to many: apply each day, recompute the total once, and roll the per-day deltas to the parent in a single update. It stays a private plugin helper, not an MCP action.
- No protocol version bump — `logTime` gains fields in its `data` payload, which is additive.
