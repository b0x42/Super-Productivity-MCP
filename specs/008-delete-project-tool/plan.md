# Implementation Plan: Delete Project Tool

**Branch**: `008-delete-project-tool` | **Date**: 2026-10-14 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/008-delete-project-tool/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Add a `delete_project` MCP tool that permanently deletes a project and its tasks, mirroring the existing `delete_task` tool. The MCP server (`src/tools/projects.ts`) validates `project_id` and forwards a `deleteProject` command over the existing file-based IPC; the SP plugin (`plugin/plugin.js`) adds a `deleteProject` case that calls `PluginAPI.deleteProject(projectId)` and surfaces SP's own cascade and Inbox-refusal errors back through the standard response shape. `plugin/manifest.json`'s `minSupVersion` is raised to the SP release that introduced the API (v19.0.1), and `README.md`'s Prerequisites and tool table are updated to match. No new IPC fields, no runtime capability probe (per clarification), no new tool beyond `delete_project` itself.

## Technical Context

**Language/Version**: TypeScript 6.x (MCP server, `src/`), JavaScript (SP plugin, `plugin/plugin.js`) — per Constitution II, no deviation
**Primary Dependencies**: `@modelcontextprotocol/sdk`, `zod` (schema validation) — both already project dependencies, no new ones added
**Storage**: N/A — no persistent storage owned by this feature; all state lives in Super Productivity itself
**Testing**: `vitest` — unit tests for the tool handler and schema (`tests/unit/tools/projects.test.ts`), plugin-level test for the new `deleteProject` case (`tests/unit/plugin/` or inline alongside existing plugin tests), per Constitution XI
**Target Platform**: Node.js >= 18 (MCP server process) + Super Productivity plugin runtime (sandboxed JS, any OS SP itself supports) — unchanged
**Project Type**: MCP server + companion SP plugin (two-component architecture, Constitution I) — single feature slotting into the existing `src/tools/projects.ts` and `plugin/plugin.js` files, no new top-level components
**Performance Goals**: N/A — single synchronous IPC round-trip per call, same cost class as the existing `delete_task`
**Constraints**: Must use the existing file-based command/response IPC (Constitution I, III); must not introduce a new command action family beyond one new `deleteProject` case; must not add a runtime `PluginAPI.deleteProject` capability probe (per spec clarification — manifest version bump is the sole gating mechanism in scope)
**Scale/Scope**: One new MCP tool (`delete_project`), one new plugin command handler (`deleteProject` case), one manifest version bump, one README update — no changes to any other tool

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Result |
|---|---|---|
| I. Two-Component Architecture | New capability is a tool (server) + a command handler (plugin), using the existing `plugin_commands/`/`plugin_responses/` file IPC. No new transport. | PASS |
| II. TypeScript-First | New tool code in `src/tools/projects.ts` is TypeScript; new plugin case in `plugin/plugin.js` is JavaScript. | PASS |
| III. Robust Communication | Reuses the existing `Command`/`Response` shape (`id`, `action`, `timestamp` / `success`, `result`, `error`, `timestamp`). No new fields required — `deleteProject` only needs `projectId`, already a first-class `Command` field. | PASS |
| IV. MCP Protocol Compliance | Tool name `delete_project` is `snake_case`. Returns `TextContent` via existing `okResult`/`errorResult` helpers. Error messages are actionable (Inbox refusal, not-found), not stack traces. | PASS |
| V. Cross-Platform by Default | No new filesystem paths introduced; reuses existing `ResolvedDirs`. | PASS (N/A — no new paths) |
| VI. Simplicity & YAGNI | Exactly one new tool mapping to exactly one `PluginAPI` call (`deleteProject`), consistent with the "one tool, one API call" rule. No bulk variant introduced (confirmed out of scope by spec Assumptions). | PASS |
| VII. Shared Directory Discovery | Not touched by this feature. | PASS (N/A) |
| VIII. SP Syntax Ownership | Not applicable — `delete_project` takes only an ID, no title text to parse. | PASS (N/A) |
| IX. Graceful Degradation | Plugin-not-running case already produces the standard "not responding" error via the existing IPC timeout path; no new degradation path needed since no runtime capability probe is added (per clarification, the manifest `minSupVersion` bump is the only version gate). | PASS |
| X. Comment the Why, Not the What | New plugin case follows the existing `deleteTask` precedent (pre-check existence to distinguish "not found" from "Inbox refusal" from other SP-side errors) — comment explaining that distinction is required, same as `archivedTaskError` already does for tasks. | PASS (enforced in tasks) |
| XI. Test-Driven Development | Tests for `delete_project` schema/handler logic and the plugin's `deleteProject` case are mandatory before/alongside implementation. | PASS (enforced in tasks) |

No violations. Complexity Tracking table is not needed.

## Project Structure

### Documentation (this feature)

```text
specs/008-delete-project-tool/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   └── delete_project.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── tools/
│   └── projects.ts          # MODIFIED: add deleteProjectSchema + delete_project tool registration
├── ipc/
│   └── types.ts             # UNCHANGED: existing Command.projectId field already covers deleteProject's payload

plugin/
├── plugin.js                # MODIFIED: add 'deleteProject' case to executeCommand's switch
└── manifest.json            # MODIFIED: bump minSupVersion to the SP release introducing deleteProject

tests/
└── unit/
    └── tools/
        └── projects.test.ts # MODIFIED: add delete_project schema + handler tests

README.md                    # MODIFIED: Prerequisites minimum version, Available Tools table entry
```

**Structure Decision**: This feature does not introduce new files or directories — it extends the three existing files (`src/tools/projects.ts`, `plugin/plugin.js`, `plugin/manifest.json`) and their existing test file (`tests/unit/tools/projects.test.ts`), following the single-project layout already in use (no `backend/`/`frontend` split, no new "Option" structure — this is additive work inside the established two-component architecture).

## Complexity Tracking

> Not applicable — no Constitution Check violations.
