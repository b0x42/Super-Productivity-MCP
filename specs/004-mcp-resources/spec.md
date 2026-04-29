# Feature Specification: MCP Resources (Read-Only Context)

**Feature Branch**: `004-mcp-resources`
**Created**: 2026-04-29
**Status**: Draft
**Input**: MCP Resources expose structured, cacheable state so AI clients start conversations already knowing projects, tags, and today's plan — eliminating the "fetch everything first" round-trip pattern.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Projects Resource (Priority: P1)

An AI client connects to the MCP server and automatically receives the list of projects with their IDs, titles, and colors. The client can reference project IDs in subsequent tool calls without first calling `get_projects`.

**Why this priority**: Projects are the most stable entity — they rarely change within a session. Caching them as a resource eliminates the most common "bootstrap" call.

**Independent Test**: Connect an MCP client, read `sp://projects`, verify it returns the same data as `get_projects` tool.

**Acceptance Scenarios**:

1. **Given** SP has 3 projects, **When** the client reads `sp://projects`, **Then** it receives a JSON array with all 3 projects including id, title, and color
2. **Given** SP is not running, **When** the client reads `sp://projects`, **Then** it receives an error indicating SP is unavailable
3. **Given** a project is created after the resource was last read, **When** the client reads `sp://projects` again, **Then** it receives the updated list

---

### User Story 2 - Tags Resource (Priority: P1)

An AI client reads the tag list with IDs so it can tag tasks without first discovering available tags via a tool call.

**Why this priority**: Same rationale as projects — tags are stable reference data needed for most task operations.

**Independent Test**: Read `sp://tags`, verify it returns all tags with id, title, color, and icon.

**Acceptance Scenarios**:

1. **Given** SP has 5 tags, **When** the client reads `sp://tags`, **Then** it receives a JSON array with all 5 tags
2. **Given** no tags exist, **When** the client reads `sp://tags`, **Then** it receives an empty array

---

### User Story 3 - Today's Tasks Resource (Priority: P2)

An AI client reads today's planned tasks to immediately know what the user is working on, enabling "what should I do next?" without any tool calls.

**Why this priority**: The most common opening question. Having this as a resource means the AI can proactively reference today's plan.

**Independent Test**: Plan 2 tasks for today, read `sp://tasks/today`, verify only those 2 tasks are returned.

**Acceptance Scenarios**:

1. **Given** 2 tasks planned for today and 3 not planned, **When** the client reads `sp://tasks/today`, **Then** it receives only the 2 planned tasks
2. **Given** no tasks planned for today, **When** the client reads `sp://tasks/today`, **Then** it receives an empty array
3. **Given** a task planned for yesterday, **When** the client reads `sp://tasks/today`, **Then** that task is NOT included

---

### User Story 4 - Overdue Tasks Resource (Priority: P2)

An AI client reads overdue tasks to proactively surface items that need attention.

**Why this priority**: Overdue tasks are high-signal context — the AI can mention them without the user asking.

**Independent Test**: Set a task due yesterday, read `sp://tasks/overdue`, verify it appears.

**Acceptance Scenarios**:

1. **Given** 2 tasks with due dates in the past, **When** the client reads `sp://tasks/overdue`, **Then** it receives those 2 tasks
2. **Given** a task due today, **When** the client reads `sp://tasks/overdue`, **Then** that task is NOT included (overdue = strictly before today)
3. **Given** no overdue tasks, **When** the client reads `sp://tasks/overdue`, **Then** it receives an empty array

---

### Edge Cases

- What happens when SP disconnects mid-resource-read? (Returns error with connection failure message)
- What happens when the resource is read rapidly in succession? (Each read triggers a fresh IPC call — no server-side caching)
- What happens when a resource URI has a typo like `sp://task/today`? (MCP SDK returns "resource not found" — only registered URIs are valid)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Server MUST expose `sp://projects` as a static resource returning all projects as JSON
- **FR-002**: Server MUST expose `sp://tags` as a static resource returning all tags as JSON
- **FR-003**: Server MUST expose `sp://tasks/today` as a static resource returning tasks planned for today
- **FR-004**: Server MUST expose `sp://tasks/overdue` as a static resource returning tasks with due dates strictly before today
- **FR-005**: All resources MUST return `application/json` MIME type
- **FR-006**: All resources MUST use the same IPC mechanism as tools (sendCommand)
- **FR-007**: Resource responses MUST include only fields useful for AI context (id, title, and key metadata — not internal SP state)
- **FR-008**: Resources MUST return an error when SP is not responding (same timeout behaviour as tools)

### Non-Functional Requirements

- **NFR-001**: Resource reads SHOULD complete within the same timeout as tool calls (30s)
- **NFR-002**: Resources MUST NOT cache data server-side — each read fetches fresh state from SP

### Key Entities

- **Resource**: A read-only, URI-addressable data endpoint registered with the MCP server
- **Project Summary**: `{ id, title, color }` — minimal project representation for AI context
- **Tag Summary**: `{ id, title, color, icon }` — minimal tag representation for AI context
- **Task Summary**: `{ id, title, projectId, tagIds, dueDay, plannedAt, timeEstimate, timeSpent, parentId }` — task fields relevant for AI planning context

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An AI client can reference project/tag IDs in its first tool call without a preceding `get_projects`/`get_tags` call
- **SC-002**: An AI client knows today's plan and overdue items at conversation start without explicit user request
- **SC-003**: Resource reads have the same reliability as tool calls (same IPC, same timeout, same error handling)
- **SC-004**: No breaking changes to existing tools — resources are purely additive

## Assumptions

- The MCP SDK `McpServer.registerResource()` is available in `@modelcontextprotocol/sdk ^1.29.0`
- MCP clients (Claude Desktop, Kiro) support reading resources — if a client doesn't support resources, it simply ignores them
- Resources are fetched on-demand by the client (not pushed) — the server does not need to implement subscriptions for v1
- The `sp://` URI scheme is arbitrary and local to this server — no global registration needed
- Fresh reads (no caching) are acceptable for v1 since the IPC latency (~2s) only occurs when the client actually reads the resource
- Resource list change notifications are out of scope for v1 (would require the plugin to push events to the server)
