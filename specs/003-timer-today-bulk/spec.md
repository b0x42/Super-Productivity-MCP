# Feature Specification: Timer Control, Today Tasks & Bulk Operations

**Feature Branch**: `003-timer-today-bulk`
**Created**: 2026-04-28
**Status**: Draft
**Input**: Feature analysis — top 3 most impactful additions: timer start/stop, today's task list, and bulk task operations.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Timer Control (Priority: P1)

An AI agent or user wants to start and stop the time tracker on a task via MCP. Currently `get_current_task` exposes the active timer state but there is no way to control it. This enables "start working on X" and "stop tracking" workflows.

**Why this priority**: Completes the time-tracking story — read without write is half a feature. Most requested by users who use SP as a time tracker.

**Independent Test**: Start a timer on a task, call `get_current_task` to confirm it's active, stop the timer, call `get_current_task` to confirm null.

**Acceptance Scenarios**:

1. **Given** no timer is running, **When** `start_task` is called with a valid task ID, **Then** the timer starts on that task and `get_current_task` returns it
2. **Given** a timer is running on task A, **When** `start_task` is called with task B, **Then** the timer switches to task B (SP's native behaviour — starting a new task stops the previous)
3. **Given** a timer is running, **When** `stop_task` is called, **Then** the timer stops and `get_current_task` returns null
4. **Given** no timer is running, **When** `stop_task` is called, **Then** the operation succeeds silently (idempotent)
5. **Given** a completed task, **When** `start_task` is called on it, **Then** the system returns an error

---

### User Story 2 - Today's Tasks (Priority: P2)

An AI agent wants to retrieve tasks planned for today — the most natural "what should I work on?" query. SP uses `plannedAt` to mark tasks as "planned for today" (distinct from due date). A dedicated filter makes this a single-call operation.

**Why this priority**: The most common question users ask a task manager. Currently requires the AI to know SP internals and filter manually.

**Independent Test**: Plan a task for today, call `get_tasks` with `planned_for_today=true`, verify only today-planned tasks are returned.

**Acceptance Scenarios**:

1. **Given** tasks with various `plannedAt` values, **When** `get_tasks` is called with `planned_for_today=true`, **Then** only tasks whose `plannedAt` falls within today (local timezone) are returned
2. **Given** a task planned for yesterday, **When** `get_tasks` is called with `planned_for_today=true`, **Then** that task is NOT returned
3. **Given** `planned_for_today=true` combined with `parents_only=true`, **When** called, **Then** only parent tasks planned for today are returned (AND logic)
4. **Given** a task with a due date of today but no `plannedAt`, **When** `get_tasks` is called with `planned_for_today=true`, **Then** that task is NOT returned (due date ≠ planned)

---

### User Story 3 - Bulk Operations (Priority: P3)

An AI agent performing triage or batch processing wants to complete, update, or delete multiple tasks in a single round-trip. The file-based IPC has ~2s latency per command; batching reduces total time from O(n×2s) to O(2s).

**Why this priority**: Dramatically improves AI triage workflows where 5–20 tasks are processed per session.

**Independent Test**: Call `bulk_complete_tasks` with 3 task IDs, verify all 3 are marked done in a single response.

**Acceptance Scenarios**:

1. **Given** 3 open tasks, **When** `bulk_complete_tasks` is called with their IDs, **Then** all 3 are marked done and the response lists all successes
2. **Given** 3 task IDs where one is invalid, **When** `bulk_complete_tasks` is called, **Then** the valid tasks are completed and the response includes an error for the invalid one (partial success)
3. **Given** 5 tasks, **When** `bulk_update_tasks` is called with different updates per task, **Then** each task receives its specified update
4. **Given** 2 task IDs, **When** `bulk_delete_tasks` is called, **Then** both tasks are removed from SP

---

### Edge Cases

- What happens when `start_task` is called on a task that is already being tracked? (idempotent — no error, timer continues)
- What happens when `start_task` is called on a subtask? (allowed — SP supports tracking subtasks)
- What happens when `planned_for_today` is combined with `overdue`? (valid — returns tasks that are both planned for today AND overdue)
- What happens when `bulk_complete_tasks` receives an empty array? (returns success with empty results)
- What happens when `bulk_delete_tasks` is called on a parent task with subtasks? (deletes the parent and all its subtasks — SP's native behaviour)
- What happens when `bulk_update_tasks` includes the same task ID twice? (last update wins)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow starting the time tracker on a task via `start_task`
- **FR-002**: System MUST allow stopping the currently running timer via `stop_task`
- **FR-003**: `start_task` on a completed task MUST return an error
- **FR-004**: `start_task` while another task is being tracked MUST switch the timer to the new task (SP native behaviour)
- **FR-005**: `stop_task` when no timer is running MUST succeed silently (idempotent)
- **FR-006**: `get_tasks` MUST support a `planned_for_today` filter that returns only tasks whose `plannedAt` timestamp falls within today's date boundaries (local timezone)
- **FR-007**: `planned_for_today` MUST be combinable with all existing filters using AND logic
- **FR-008**: System MUST support `bulk_complete_tasks` accepting an array of task IDs and marking all as done
- **FR-009**: System MUST support `bulk_update_tasks` accepting an array of `{task_id, ...fields}` objects
- **FR-010**: System MUST support `bulk_delete_tasks` accepting an array of task IDs and removing them
- **FR-011**: Bulk operations MUST use partial-success semantics: process all items, report per-item success/error
- **FR-012**: Bulk operations with an empty array MUST return success with empty results

### Key Entities

- **Task**: Extended with timer state (`currentTimestamp`) and planning state (`plannedAt`)
- **Timer**: Implicit state — a task with `currentTimestamp > 0` has an active timer
- **Bulk Result**: Array of `{ id, success, error? }` per item

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An agent can start and stop time tracking without manual SP interaction
- **SC-002**: An agent can retrieve today's planned tasks in a single `get_tasks` call
- **SC-003**: Bulk operations reduce IPC round-trips from O(n) to O(1) for batch processing
- **SC-004**: All new operations return explicit success or error responses with no silent failures
- **SC-005**: Partial failures in bulk operations do not prevent processing of remaining items

## Assumptions

- `start_task` uses `dispatchAction` with NgRx action `[Task] Set Current Task` (no native PluginAPI method exists)
- `stop_task` uses `dispatchAction` with NgRx action `[Task] Unset Current Task` (no native PluginAPI method exists)
- SP's `plannedAt` is a Unix ms timestamp set when a task is moved to "Today" view
- A task is "planned for today" if `plannedAt` falls between `startOfToday` and `endOfToday` in local timezone
- `bulk_delete_tasks` removes tasks permanently (not archive) — matches SP's delete behaviour
- Bulk operations are processed sequentially within the plugin to avoid race conditions
- The protocol version does NOT need a bump — all additions are additive
