# Tasks: Super Productivity MCP Server

**Input**: Design documents from `specs/001-sp-mcp-server/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/command-protocol.md

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup

**Purpose**: Project initialization and build tooling

- [x] T001 Initialize npm project with package.json (name: super-productivity-mcp, bin entry, node >=18) in project root
- [x] T002 [P] Create tsconfig.json with strict mode, ES2020 target, NodeNext module resolution in project root
- [x] T003 [P] Create tsup.config.ts with entry src/index.ts, CJS output, target node18 in project root
- [x] T004 [P] Add dev dependencies: typescript, tsup, vitest, @types/node, zod in package.json
- [x] T005 [P] Add runtime dependencies: @modelcontextprotocol/sdk in package.json
- [x] T006 [P] Create .gitignore with node_modules, dist, *.log in project root
- [x] T007 [P] Create LICENSE (MIT) in project root

**Checkpoint**: `npm install` succeeds, `npx tsup` produces dist/index.js

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: IPC layer and directory resolution that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T008 Define Command and Response TypeScript interfaces in src/ipc/types.ts per data-model.md (Command, Response, TaskFilters, McpConfig)
- [x] T009 Implement cross-platform directory resolution in src/ipc/directories.ts — probe macOS (sandbox, standard), Linux (Snap, XDG, standard), Windows (APPDATA); support SP_MCP_DATA_DIR env override; write mcp_config.json when override is set; create dirs with 700 permissions, files with 600
- [x] T010 Implement command-sender in src/ipc/command-sender.ts — write command JSON files, poll for response files with configurable timeout (default 30s), clean up response files after reading, clean up orphaned commands on timeout, clean stale files (>5min) on startup; return clear error message when plugin not responding
- [x] T011 Create MCP server entry point in src/server.ts — instantiate McpServer with name "super-productivity" and version from package.json, connect via StdioServerTransport
- [x] T012 Create package entry point in src/index.ts — import and run server, add shebang for npx execution
- [x] T013 [P] Write unit tests for directory resolution in tests/unit/directories.test.ts — mock os.platform/homedir, test all 6 platform variants, test SP_MCP_DATA_DIR override, test mcp_config.json write
- [x] T014 [P] Write unit tests for command-sender in tests/unit/command-sender.test.ts — mock filesystem, test write/poll/cleanup cycle, test timeout with clear error message, test stale file cleanup

**Checkpoint**: Foundation ready — `npx tsup` builds, tests pass, server starts and exits cleanly via stdio

---

## Phase 3: User Story 1 — Manage Tasks via AI Assistant (Priority: P1) 🎯 MVP

**Goal**: Create, list, update, and complete tasks through any MCP client

**Independent Test**: Create a task, verify in SP Inbox. Update title/notes. Mark complete. List all tasks with filters.

### Implementation for User Story 1

- [x] T015 [US1] Register `create_task` tool in src/tools/tasks.ts — Zod schema: title (required string), notes (optional), project_id (optional), parent_id (optional), tag_ids (optional string array); validate title non-empty (FR-024); send addTask command; document SP short syntax in tool description (FR-015)
- [x] T016 [US1] Implement subtask SP syntax workaround in src/tools/tasks.ts — when parent_id is set and title contains @/#/+, strip syntax for addTask then updateTask with original title (FR-016)
- [x] T017 [US1] Register `get_tasks` tool in src/tools/tasks.ts — Zod schema: project_id (optional), tag_id (optional), include_done (optional bool, default false), include_archived (optional bool, default false), search_query (optional string); send getTasks command; apply server-side filtering on response (FR-002)
- [x] T018 [US1] Register `update_task` tool in src/tools/tasks.ts — Zod schema: task_id (required), title (optional), notes (optional), is_done (optional bool), time_estimate (optional number), time_spent (optional number); validate task_id non-empty (FR-024); send updateTask command
- [x] T019 [US1] Register `complete_task` tool in src/tools/tasks.ts — Zod schema: task_id (required); validate task_id non-empty; send setTaskDone command (FR-004)
- [x] T020 [P] [US1] Write unit tests for task tools in tests/unit/tools/tasks.test.ts — mock command-sender, test create (with/without SP syntax, with parent_id workaround), get (all filter combinations), update, complete; test input validation rejects empty title/id with isError:true (FR-025)

**Checkpoint**: Task CRUD fully functional. Can create, list, filter, update, and complete tasks via MCP.

---

## Phase 4: User Story 2 — Manage Projects and Tags (Priority: P2)

**Goal**: Create, list, and update projects and tags through MCP

**Independent Test**: Create a project, verify in SP. Create a tag with color. List both. Update properties.

### Implementation for User Story 2

- [x] T021 [P] [US2] Register `create_project`, `get_projects`, `update_project` tools in src/tools/projects.ts — Zod schemas per contract; validate title non-empty for create, project_id non-empty for update; send addProject/getAllProjects/updateProject commands
- [x] T022 [P] [US2] Register `create_tag`, `get_tags`, `update_tag` tools in src/tools/tags.ts — Zod schemas per contract; validate title non-empty for create, tag_id non-empty for update; send addTag/getAllTags/updateTag commands
- [ ] T023 [P] [US2] Write unit tests for project tools in tests/unit/tools/projects.test.ts — mock command-sender, test create/list/update, test input validation
- [ ] T024 [P] [US2] Write unit tests for tag tools in tests/unit/tools/tags.test.ts — mock command-sender, test create/list/update, test input validation

**Checkpoint**: Project and tag management fully functional alongside task CRUD.

---

## Phase 5: User Story 3 — Connection Health and Diagnostics (Priority: P3)

**Goal**: Verify connection status and troubleshoot directory paths

**Independent Test**: Run check_connection with/without SP. Run debug_directories to see resolved paths.

### Implementation for User Story 3

- [x] T025 [US3] Register `check_connection` tool in src/tools/diagnostics.ts — no input params; send ping command with short timeout (5s); return plugin version, protocol version, data paths on success; return clear error message on timeout (FR-012, IX)
- [x] T026 [US3] Register `debug_directories` tool in src/tools/diagnostics.ts — no IPC needed; return resolved base/command/response dirs and existence status from directories.ts (FR-013)
- [ ] T027 [P] [US3] Write unit tests for diagnostic tools in tests/unit/tools/diagnostics.test.ts — test ping success/timeout, test debug_directories output

**Checkpoint**: Users can verify connection and troubleshoot paths.

---

## Phase 6: User Story 4 — Notifications (Priority: P4)

**Goal**: Show notifications in SP's UI via MCP

**Independent Test**: Send notification, verify snackbar appears in SP.

### Implementation for User Story 4

- [x] T028 [US4] Register `show_notification` tool in src/tools/notifications.ts — Zod schema: message (required string), type (optional enum SUCCESS/INFO/WARNING/ERROR, default INFO); validate message non-empty; send showSnack command
- [ ] T029 [P] [US4] Write unit tests for notification tool in tests/unit/tools/notifications.test.ts — test with/without type, test empty message validation

**Checkpoint**: Notifications work end-to-end.

---

## Phase 7: User Story 5 — Worklog and Productivity Metrics (Priority: P5)

**Goal**: Return time-tracking summaries computed from task data

**Independent Test**: Create tasks with timeSpentOnDay, request worklog for date range, verify totals.

### Implementation for User Story 5

- [x] T030 [US5] Register `get_worklog` tool in src/tools/tasks.ts — Zod schema: start_date (required string, ISO date), end_date (required string, ISO date); send getTasks command (with includeDone + includeArchived); compute server-side: daily totals, per-project breakdown, per-tag breakdown, tasks completed count, estimate vs actual accuracy (FR-023)
- [x] T031 [P] [US5] Write unit tests for worklog tool in tests/unit/tools/tasks.test.ts — mock task data with timeSpentOnDay, test date range filtering, test per-project/tag aggregation, test estimate accuracy calculation

**Checkpoint**: Worklog summaries work for any date range.

---

## Phase 8: SP Plugin

**Purpose**: The Super Productivity plugin that executes commands against PluginAPI

- [ ] T032 Create plugin manifest in plugin/manifest.json — id: sp-mcp-bridge, manifestVersion: 1, minSupVersion: 14.0.0, permissions: [nodeExecution], hooks: [taskUpdate, taskComplete, taskDelete, currentTaskChange], iFrame: true, isSkipMenuEntry: true
- [ ] T033 Implement plugin core in plugin/plugin.js — directory discovery (same probe logic as server), command polling loop (2s default, configurable), command dispatch switch for all actions (addTask, getTasks, updateTask, setTaskDone, getAllProjects, addProject, updateProject, getAllTags, addTag, updateTag, showSnack, ping), response writing, command file cleanup, stale file cleanup on init, protocol version validation, error handling for unknown actions and invalid JSON
- [ ] T034 Implement subtask SP syntax workaround in plugin/plugin.js — detect parentId + @/#/+ in title, create with clean title, then updateTask with original title
- [ ] T035 Implement archived task support in plugin/plugin.js — when getTasks command has filters.includeArchived, call both PluginAPI.getTasks() and PluginAPI.getArchivedTasks(), merge results
- [ ] T036 [P] Create minimal plugin/index.html — empty dashboard placeholder for v1
- [ ] T037 [P] Create plugin build script in package.json — zip plugin/manifest.json + plugin/plugin.js + plugin/index.html into dist/plugin.zip

**Checkpoint**: Plugin installable in SP, responds to ping, executes all command actions.

---

## Phase 9: Integration Testing

**Purpose**: End-to-end verification with mocked filesystem

- [ ] T038 Write integration test for full command→response round-trip in tests/integration/round-trip.test.ts — mock filesystem, test create_task writes command file, mock plugin response, verify server reads and returns result; test timeout scenario; test stale cleanup

**Checkpoint**: Full IPC cycle verified without running SP.

---

## Phase 10: Polish & Distribution

**Purpose**: README, packaging, final quality

- [ ] T039 Write README.md — project description, prerequisites, installation (npx + plugin.zip), MCP client config examples (Claude Desktop, Kiro), quickstart (check_connection, create task, list tasks), SP short syntax reference, troubleshooting (SP_MCP_DATA_DIR, debug_directories), contributing
- [ ] T040 [P] Configure package.json for npm publishing — main: dist/index.js, bin: dist/index.js, files: [dist, README.md, LICENSE], repository, keywords
- [ ] T041 [P] Add eslint config with TypeScript support in eslint.config.js
- [ ] T042 Run full test suite and fix any failures
- [ ] T043 Run quickstart.md validation — verify documented steps work end-to-end

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **User Stories (Phases 3–7)**: All depend on Foundational phase completion
  - US1 (P1) → US2 (P2) → US3 (P3) → US4 (P4) → US5 (P5) sequentially, or in parallel if staffed
- **SP Plugin (Phase 8)**: Depends on Foundational (uses same IPC types/protocol). Can run in parallel with server-side user stories.
- **Integration (Phase 9)**: Depends on at least US1 + Plugin phases
- **Polish (Phase 10)**: Depends on all prior phases

### Parallel Opportunities

- T002, T003, T004, T005, T006, T007 — all setup files, no dependencies
- T013, T014 — unit tests for foundational, parallel with each other
- T021, T022 — project and tag tools, independent files
- T023, T024 — project and tag tests, independent files
- T032–T037 (Plugin phase) can run in parallel with Phases 3–7 (server tools)
- T039, T040, T041 — README, package config, eslint, all independent

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (IPC layer)
3. Complete Phase 3: User Story 1 (task CRUD)
4. Complete Phase 8: SP Plugin
5. **STOP and VALIDATE**: Test task CRUD end-to-end with SP
6. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add US1 → Task CRUD works → MVP!
3. Add US2 → Projects and tags → More useful
4. Add US3 → Diagnostics → Supportable
5. Add US4 → Notifications → Nice-to-have
6. Add US5 → Worklog → Power feature
7. Polish → README, npm publish → Releasable
