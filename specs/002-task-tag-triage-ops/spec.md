# Feature Specification: Task Tag & Triage Operations

**Feature Branch**: `002-task-tag-triage-ops`
**Created**: 2026-04-20
**Status**: Draft
**Input**: User description: "add_tag_to_task, remove_tag_from_task, tag_ids in update_task, reorder_tasks, move_task_to_project, get_current_task, and three triage filters (parents_only, overdue, unscheduled)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Tag Management on Tasks (Priority: P1)

An AI agent or user wants to add or remove individual tags from tasks without replacing all existing tags. This allows incremental tag changes (e.g., labelling a task with a goal tag during triage) without knowing or restating the full current tag list. update_task should also support bulk-replacing all tags at once.

**Why this priority**: Tag operations are the most frequently needed mutation in triage workflows and are entirely absent today.

**Independent Test**: Add a tag to a task that already has other tags and confirm the existing tags remain unchanged. Remove a tag and verify the target tag is gone while others persist.

**Acceptance Scenarios**:

1. **Given** a task with tags [A, B], **When** add_tag_to_task is called with tag C, **Then** the task has tags [A, B, C]
2. **Given** a task with tags [A, B, C], **When** remove_tag_from_task is called with tag B, **Then** the task has tags [A, C]
3. **Given** a task with no tags, **When** add_tag_to_task is called, **Then** the task has exactly that one tag
4. **Given** a task that does not have tag X, **When** remove_tag_from_task is called with tag X, **Then** the operation returns an appropriate error or completes as a no-op
5. **Given** a valid update_task call with a tag_ids list, **When** the call completes, **Then** the task's tags are exactly the provided list

---

### User Story 2 - Triage Filters for Task Retrieval (Priority: P2)

An AI agent running an inbox triage workflow needs to retrieve only the tasks requiring attention: parent tasks that are overdue, unscheduled, or never scheduled. Fetching all tasks and filtering manually wastes context window space.

**Why this priority**: These filters are the core enabler of automated triage — without them, agents must process the entire task list every session.

**Independent Test**: Call get_tasks with each filter individually and confirm only matching tasks are returned; then combine filters and confirm AND logic applies.

**Acceptance Scenarios**:

1. **Given** tasks including subtasks, **When** get_tasks is called with parents_only=true, **Then** no subtasks appear in the result
2. **Given** tasks with various due dates including some past dates, **When** get_tasks is called with overdue=true, **Then** only tasks whose due date is before today are returned
3. **Given** tasks where some have no due date, **When** get_tasks is called with unscheduled=true, **Then** only tasks with no due date and no scheduled time are returned
4. **Given** a mix of tasks, **When** get_tasks is called with parents_only=true and unscheduled=true, **Then** only parent tasks with no due date are returned

---

### User Story 3 - Task Organisation Operations (Priority: P3)

An AI agent or user wants to move a task to a different project, reorder tasks within a project for prioritisation, or retrieve the currently active/tracked task for context.

**Why this priority**: Organisation operations are useful but not blocking for core triage. get_current_task enables time-tracking context awareness.

**Independent Test**: Each operation is independently testable. Move: task appears under target project. Reorder: tasks appear in specified order. Get current: returns active task or null.

**Acceptance Scenarios**:

1. **Given** a task in Project A, **When** move_task_to_project is called with Project B, **Then** the task belongs to Project B and no longer appears under Project A
2. **Given** three tasks in a project, **When** reorder_tasks is called with a new order, **Then** the tasks appear in that order within the project
3. **Given** a task with an active timer, **When** get_current_task is called, **Then** the active task is returned
4. **Given** no task is being timed, **When** get_current_task is called, **Then** null is returned

---

### Edge Cases

- What happens when add_tag_to_task is called with a tag already on the task? (should be idempotent — no error, no duplicate)
- What happens when reorder_tasks is called with task IDs that don't all belong to the specified project/parent?
- What happens when move_task_to_project is called for a subtask? (subtasks have a parent, not a direct project — out of scope)
- What happens when overdue and unscheduled filters are combined? (logically exclusive — a task with no due date cannot be overdue; result should be empty)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow adding a single tag to a task without modifying its other existing tags
- **FR-002**: System MUST allow removing a single tag from a task without modifying its other existing tags
- **FR-003**: System MUST allow bulk-replacing all tags on a task by providing a complete tag list via update_task
- **FR-004**: get_tasks MUST support a parents_only filter that excludes all subtasks from results
- **FR-005**: get_tasks MUST support an overdue filter that returns only tasks with a due date strictly before today's date
- **FR-006**: get_tasks MUST support an unscheduled filter that returns only tasks with no due date and no scheduled time
- **FR-007**: All triage filters MUST be combinable with each other and with existing filters using AND logic
- **FR-008**: System MUST allow moving a top-level task to a different project
- **FR-009**: System MUST allow reordering tasks within a project, or subtasks within a parent task, using a provided ordered list of task IDs
- **FR-010**: System MUST expose the currently time-tracked task, returning null when no task has an active timer

### Key Entities

- **Task**: Has an ID, title, project assignment, tag list, due date, parent ID (if subtask), and active-timer state
- **Tag**: Has an ID; tasks reference tags by ID
- **Project**: Has an ID; top-level tasks belong to at most one project

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An agent can retrieve only triage-relevant tasks in a single call using combined filters, with no post-fetch filtering required
- **SC-002**: Tag add/remove operations preserve all pre-existing tags on the task — zero data loss on existing tag assignments
- **SC-003**: All 10 new or modified operations return an explicit success or error response with no silent failures
- **SC-004**: Triage filter combinations (parents_only + overdue, parents_only + unscheduled) return only the intersection of matching tasks

## Assumptions

- add_tag_to_task is idempotent: calling it with a tag already on the task succeeds silently
- remove_tag_from_task on a tag not present on the task returns an error (not silent)
- reorder_tasks takes a complete ordered list — partial reordering within a larger set is not supported
- move_task_to_project applies only to top-level tasks; moving subtasks is out of scope
- get_current_task returns the task with an active running timer, not merely the most recently viewed task
- The overdue filter uses today's local date as the comparison boundary
- Combining overdue=true and unscheduled=true returns an empty result set (logically exclusive)
