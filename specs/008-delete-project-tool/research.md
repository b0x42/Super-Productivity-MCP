# Research: Delete Project Tool

No `NEEDS CLARIFICATION` markers remain in the Technical Context (all three clarification rounds in spec.md already resolved the open product questions). This document records the two implementation-level decisions needed before design: the exact `minSupVersion` value, and the plugin-side error-shaping pattern to reuse.

## Decision: `minSupVersion` target value

**Decision**: Set `plugin/manifest.json`'s `minSupVersion` to `"19.0.1"`.

**Rationale**: The public Super Productivity GitHub releases changelog for `v19.0.1` explicitly lists "a new deleteProject plugin API" under its Integrations and plugins section (verified directly against the release notes, not inferred). `v19.0.1` is also described in its own release as consolidating everything since `v18.21.1`, including unpublished `18.21.2`/`18.22.0`/`19.0.0` changes — so `19.0.1` is the first version string that was actually published to end users with this capability. Pinning to the next release (`19.1.0` or `19.2.0`) would be an unjustified-stricter floor; pinning lower would understate the real requirement.

**Alternatives considered**:
- Leave `minSupVersion` at `14.0.0` and rely on users discovering the failure at runtime — rejected per spec FR-009 and clarification: the manifest bump is required, and no runtime probe is being added as a safety net, so the manifest is the only signal a user gets before installing/using the plugin.
- Bump to the latest release at implementation time regardless of when `deleteProject` actually shipped — rejected as needlessly exclusionary of users on `19.0.1`–`19.1.x` who already have the capability.

## Decision: plugin-side error shaping for `deleteProject`

**Decision**: Mirror the existing `deleteTask` case's structure exactly: look up the project by ID first via `PluginAPI.getAllProjects()`, return a clear "not found" error if absent, special-case the Inbox by its fixed, well-known ID `'INBOX_PROJECT'` before calling `PluginAPI.deleteProject`, then call `PluginAPI.deleteProject(command.projectId)` and let it throw for any other failure the host surfaces (which the existing top-level `try`/`catch` in `executeCommand` already converts into the standard `{success: false, error, timestamp}` shape).

**Rationale**: `deleteTask`'s existing case (`plugin/plugin.js`) already establishes the exact pattern this feature needs — pre-check existence to produce a precise "not found" message, then delegate to the real `PluginAPI` call and let it do the actual work. `PluginAPI.deleteProject` is documented (official `@super-productivity/plugin-api` types) to itself refuse Inbox deletion and cascade-delete tasks — reimplementing that cascade logic client-side would violate Constitution VI (Simplicity & YAGNI) and risk drifting from SP's own behavior. The one addition beyond the `deleteTask` precedent is recognizing the Inbox case specifically (FR-004) and surfacing it as a clear, named error before even calling the host method — verified directly against Super Productivity's own source (`src/app/features/project/project.const.ts`): the Inbox is a hardcoded `Project` constant with a fixed `id: 'INBOX_PROJECT'`, not a flag on arbitrary projects, so this check is a plain string comparison, not a lookup or heuristic.

**Alternatives considered**:
- Call `PluginAPI.deleteProject` directly with no existence pre-check, relying entirely on whatever error the host throws — rejected because `deleteTask`'s existing pre-check precedent exists specifically to produce a predictable, testable error message rather than depending on the exact wording of an SP-internal exception.
- Reimplement the Inbox-refusal and cascade logic in the plugin instead of delegating to `PluginAPI.deleteProject` — rejected per Constitution VI and the spec's explicit Assumption that this feature does not reimplement SP's own cascade.

## Correction (found during manual E2E validation, T013): `deleteProject` requires an explicit manifest permission

**What happened**: the official `@super-productivity/plugin-api` TypeScript types and SP's own source code (both checked during planning) show no indication that calling `PluginAPI.deleteProject` requires anything beyond the method being present. The live host disagreed: the first manual test call failed with `"[PluginBridge] PluginAPI.deleteProject is blocked: this plugin does not declare the \"deleteProject\" permission. Add \"deleteProject\" to the manifest \"permissions\"."` — a runtime permission gate not documented in the plugin-api types package, not mentioned in the changelog, and not inferable from the source files read during Phase 0/1 research.

**Resolution**: added `"deleteProject"` to `plugin/manifest.json`'s `permissions` array (alongside the existing `"nodeExecution"` and `"showIndexHtmlAsView"`). After rebuilding and reinstalling the plugin, all 11 quickstart.md steps passed as documented.

**Why this wasn't caught earlier**: this is a genuine gap in the available documentation sources, not a research error — the permission requirement only surfaces at runtime from the live plugin host, and no static source (types package, GitHub source, changelog) mentioned it. Recorded here so a future contributor reviewing this feature's research doesn't wonder why `deleteTask`-pattern work alone wasn't sufficient.

## Resolved during review: archived projects need no special handling

A code review raised the question of whether `deleteProject`'s existence check needs an archived-project equivalent of `deleteTask`'s `archivedTaskError()` helper — tasks have that helper specifically because `PluginAPI.getTasks()` excludes archived tasks, so a naive existence check misreports them as "not found".

**Resolution**: no equivalent is needed for projects. Confirmed against the official `Project` type (`@super-productivity/plugin-api`): `isArchived` is a plain boolean field on the same `Project` object `getAllProjects()` already returns — there is no separate project archive store analogous to `getArchivedTasks()`. An archived project's id is found by the existing lookup exactly like any other project's. Verified by test (`tests/unit/plugin/executeCommand.test.ts`, "deletes an archived project found via getAllProjects(), same as any other").
