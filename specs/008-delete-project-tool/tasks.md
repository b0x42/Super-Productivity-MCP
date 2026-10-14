---

description: "Task list template for feature implementation"
---

# Tasks: Delete Project Tool

**Input**: Design documents from `/specs/008-delete-project-tool/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/delete_project.md, quickstart.md

**Tests**: Mandatory, not optional — Constitution XI (Test-Driven Development, NON-NEGOTIABLE) requires tests written before or alongside implementation, with no untested code path in the tools or IPC layers.

**Organization**: This feature has exactly one user story (US1, P1 — see spec.md). All tasks below belong to it; there is no multi-story split.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 for every task in this feature (single-story feature)
- Include exact file paths in descriptions

## Path Conventions

Single project (per plan.md Structure Decision) — `src/`, `plugin/`, `tests/` at repository root. No new directories.

---

## Phase 1: Setup

**Purpose**: No project initialization needed — this feature extends existing files only. No setup tasks apply.

*(Phase intentionally empty: `src/tools/projects.ts`, `plugin/plugin.js`, `plugin/manifest.json`, and `tests/unit/tools/projects.test.ts` already exist and are configured; nothing to scaffold.)*

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: No shared infrastructure is needed before US1 can start — this feature adds one tool, one plugin case, and one manifest/README edit, all independent of any other in-flight work. No foundational tasks apply.

**Checkpoint**: Foundation ready (trivially — nothing to build). User Story 1 work can begin immediately.

---

## Phase 3: User Story 1 - Delete a project through the MCP server (Priority: P1) 🎯 MVP

**Goal**: An AI assistant can call a new `delete_project` tool with a project ID and have Super Productivity permanently remove that project and all tasks it contains, with clear errors for the Inbox, nonexistent IDs, and repeat deletion.

**Independent Test**: Create a project via `create_project`, add a task to it via `create_task`, call `delete_project` with the project's ID, then call `get_projects` and `get_tasks` to confirm both the project and its task are gone (per spec.md Independent Test and quickstart.md manual steps 4–8).

### Tests for User Story 1 (write FIRST, confirm they FAIL before implementation) ⚠️

- [ ] T001 [P] [US1] Add `deleteProjectSchema` strict-schema tests in `tests/unit/tools/projects.test.ts`: accepts `{ project_id: string }`; rejects missing `project_id`; rejects an unrecognized extra parameter (naming it in the error, matching the existing `update_project schema — strict unknown-key rejection` describe block's style in the same file)
- [ ] T002 [P] [US1] Add `delete_project` handler tests (via the real registered handler, following the `toolHandlers` capture pattern already used in `tests/unit/tools/projects.test.ts` for `update_project description`) covering: empty/whitespace `project_id` is rejected before `sendCommand` is called; a valid `project_id` sends `sendCommand(dirs, 'deleteProject', { projectId: project_id })`; a successful `null`-result response returns `{ success: true }` (per contracts/delete_project.md Output Shape); an error response's `error` string passes through unchanged
- [ ] T003 [P] [US1] Add plugin-level tests in `tests/unit/plugin/executeCommand.test.ts` (new `describe('executeCommand: deleteProject', ...)` block, following the existing `globalThis.PluginAPI` stub pattern in that file) covering: existing non-Inbox project ID calls `PluginAPI.deleteProject(projectId)` and returns `{ success: true, result: null }`; nonexistent project ID returns `{ success: false, error: 'Project not found: <id>' }` without calling `PluginAPI.deleteProject`; project ID `'INBOX_PROJECT'` returns `{ success: false, error: 'The Inbox project cannot be deleted.' }` without calling `PluginAPI.deleteProject` (per data-model.md IPC Command/Response shapes and research.md's Inbox-refusal decision)
- [ ] T004 [P] [US1] Add a test to `tests/unit/plugin/version.test.ts` or a new assertion confirming `plugin/manifest.json`'s `minSupVersion` is `"19.0.1"` (pin the value the way `version.test.ts` already pins `PLUGIN_VERSION` against the manifest, so a future accidental revert is a red test — per research.md's `minSupVersion` decision)

**Run `npm test` now and confirm all four new test files/blocks FAIL** (the schema, handler, and plugin case do not exist yet) before proceeding to implementation.

### Implementation for User Story 1

- [ ] T005 [US1] Add `deleteProjectShape`/`deleteProjectSchema` (`.strict()`, single required `project_id: z.string()` field, `.describe()` text stating plainly that this also deletes the project's tasks per spec FR-008) to `src/tools/projects.ts`, following the exact shape/schema pattern already used by `updateProjectShape`/`updateProjectSchema` in the same file (depends on: T001 existing as a failing test)
- [ ] T006 [US1] Register the `delete_project` tool in `registerProjectTools()` in `src/tools/projects.ts`: validate `project_id` is non-empty/non-whitespace (`errorResult('project_id is required')`, mirroring `delete_task`'s existing validation in `src/tools/tasks.ts`), call `sendCommand(dirs, 'deleteProject', { projectId: project_id })`, return `errorResult(res.error ?? 'Failed to delete project')` on failure or `okResult({ success: true })` on success (depends on: T005)
- [ ] T007 [US1] Add a `case 'deleteProject':` to the `switch` in `executeCommand()` in `plugin/plugin.js`: look up the project by `command.projectId` via `PluginAPI.getAllProjects()`; if `command.projectId === 'INBOX_PROJECT'`, return `{ success: false, error: 'The Inbox project cannot be deleted.', timestamp: Date.now() }` without calling the host method; if the project is not found in the list, return `{ success: false, error: 'Project not found: ' + command.projectId, timestamp: Date.now() }`; otherwise call `await PluginAPI.deleteProject(command.projectId)` and set `result = null`, following the exact structural precedent of the existing `case 'deleteTask':` block (depends on: T003 existing as failing tests). Add a comment explaining *why* the Inbox check happens before the lookup/host call (Constitution X — comment the why, not the what; e.g. so a caller gets a precise, named error instead of relying on whatever generic refusal message the host might produce)
- [ ] T008 [US1] Bump `plugin/manifest.json`'s `minSupVersion` from `"14.0.0"` to `"19.0.1"` per research.md's decision (depends on: T004 existing as a failing test)
- [ ] T009 [US1] Bump `plugin/plugin.js`'s `PLUGIN_VERSION` constant and `package.json`'s `version` field together (following the project's existing versioning convention — PATCH for this change per the Constitution's semantic versioning rule, since it's a new tool, not a breaking schema change, so actually MINOR; confirm against `plugin/manifest.json`'s own `version` field, which the existing `version.test.ts` already pins to this constant) so `check_connection`'s reported `pluginVersion` reflects the release that ships `delete_project` (depends on: T007, T008)

**Checkpoint**: Run `npm test` again — T001–T004's tests MUST now pass (green). `delete_project` is fully functional and independently testable end-to-end per quickstart.md's automated and manual sections.

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Documentation and final validation — no code changes beyond what Phase 3 already delivered.

- [ ] T010 [P] Update `README.md`'s Prerequisites section: change the minimum Super Productivity version line from `>= 14.0.0` to `>= 19.0.1` only if `delete_project` becomes the new overall minimum (confirm whether other tools still require only `14.0.0` and, if so, phrase this the same way the existing habit-tools caveat is phrased — i.e. add a `delete_project` caveat line analogous to "Habit tools ... require a Super Productivity build newer than the `14.0.0` minimum above" — rather than silently raising the blanket minimum for all tools) per spec FR-009
- [ ] T011 [P] Add a `delete_project` row to the "Available Tools" table in `README.md`, directly after the `update_project` row, with a description matching the tone of the existing `delete_task` row ("Permanently delete a task (parent deletes subtasks too)...") — e.g. "Permanently delete a project and all tasks it contains. Cannot delete the Inbox."
- [ ] T012 Run `npm run typecheck`, `npm run lint`, and `npm test` together; fix any failures before considering the feature complete
- [ ] T013 Execute the manual end-to-end validation steps in `quickstart.md` (steps 1–11) against a running Super Productivity >= 19.0.1 instance with the rebuilt `dist/plugin.zip` installed, confirming all three edge cases (repeat deletion, Inbox refusal, nonexistent ID) behave exactly as documented

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Empty — nothing to complete.
- **Foundational (Phase 2)**: Empty — nothing to complete.
- **User Story 1 (Phase 3)**: Can start immediately. Tests (T001–T004) MUST be written and confirmed failing before implementation (T005–T009).
- **Polish (Phase 4)**: Depends on Phase 3 being complete (T010–T011 need the final tool/README shape to describe; T012–T013 validate the finished feature).

### Within User Story 1

- T001, T002, T003, T004 — parallel, independent files/blocks, no dependencies on each other.
- T005 depends on T001 (schema test must exist first, per TDD).
- T006 depends on T005 (schema must exist before the tool handler using it).
- T007 depends on T003 (plugin test must exist first).
- T008 depends on T004 (manifest-version test must exist first).
- T009 depends on T007 and T008 (version bump happens once the feature it describes is actually complete).

### Parallel Opportunities

- T001, T002, T003, T004 can all be written in parallel (different files or independent describe blocks in the same file, no shared state).
- T010 and T011 can be done in parallel (both edit `README.md` but in clearly separate, non-overlapping sections — Prerequisites vs. the tools table — so treat as logically parallel even though they touch the same file; apply sequentially if a tool enforces single-writer file edits).

---

## Parallel Example: User Story 1

```bash
# Launch all four test tasks for User Story 1 together:
Task: "Add deleteProjectSchema strict-schema tests in tests/unit/tools/projects.test.ts"
Task: "Add delete_project handler tests in tests/unit/tools/projects.test.ts"
Task: "Add plugin-level deleteProject tests in tests/unit/plugin/executeCommand.test.ts"
Task: "Add a minSupVersion-pinning test in tests/unit/plugin/version.test.ts"
```

---

## Implementation Strategy

### MVP First (and only) — User Story 1

1. Skip Phase 1 and Phase 2 (both empty for this feature).
2. Write T001–T004 (failing tests).
3. Implement T005–T009 in dependency order.
4. **STOP and VALIDATE**: `npm test` green, then quickstart.md automated section passes.
5. Do Phase 4 polish (README, final lint/typecheck/test pass, manual E2E).
6. This single story IS the full feature — there is no incremental multi-story rollout for this spec.

### Parallel Team Strategy

Not applicable at this scope — a single developer can complete T001–T013 sequentially within the dependency graph above; the "parallel" markers only indicate independent files/blocks, not a need for multiple contributors.

---

## Notes

- [P] tasks = different files or independent blocks, no dependencies on each other.
- Every implementation task (T005–T009) traces to a specific FR in spec.md and a specific decision in research.md/data-model.md/contracts/delete_project.md — no task here introduces behavior the design docs didn't already specify.
- Commit after each task or logical group (the project's `after_implement` auto-commit hook, if invoked per-task via `/speckit.implement`, already handles this).
- Verify tests fail before implementing (T001–T004 before T005–T009) — Constitution XI is explicit that this is non-negotiable.
- This feature deliberately has only one user story; there is no "stop after P1" tradeoff to make — completing Phase 3 completes the feature.
