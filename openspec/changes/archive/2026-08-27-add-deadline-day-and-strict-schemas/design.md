## Context

See proposal.md - Why. Two independent gaps in `src/tools/*.ts`, both surfaced by issue #101:

1. `deadlineDay` is readable (`get_tasks` + `fields`) but not writable anywhere.
2. Every tool's `inputSchema` is a Zod raw shape. The MCP SDK (`server.registerTool`) wraps a raw shape as `z.object(shape)` and parses incoming args against it before calling the handler. Zod's default object mode is `strip`: unrecognized keys are silently dropped from the parsed result rather than raising an error. This is a property of every tool in the codebase, not specific to `update_task` — and it also applies to nested schemas, e.g. the `z.object({...})` items inside `bulk_update_tasks`'s `updates` array and `create_task`'s `subtasks` array (`tasks.ts:421`), since those are themselves plain Zod objects with the same default.

The plugin (`plugin/plugin.js`) requires no change for gap 1 — its `addTask`/`updateTask` command handlers pass `command.data` straight to `PluginAPI` without a field allowlist (`plugin.js:272-282`, `plugin.js:244-248`).

Verified against the exact pinned SDK version (`@modelcontextprotocol/sdk@1.25.3`) and Zod version (`zod@^4.3.6`): `registerTool`'s `inputSchema` type and runtime both accept a pre-built `ZodObject` instance directly (not only a raw shape) and use that exact instance for parsing — so passing a `.strict()`-wrapped schema object (rather than the bare shape) is both necessary and sufficient to make strictness take effect at runtime. Zod v4 still supports `.strict()` (legacy but functional, not removed).

## Goals / Non-Goals

**Goals:**
- `deadline_day` writable on `create_task`, `update_task`, `bulk_update_tasks`, using the exact same `value || null` clear-on-empty-string convention as the existing `due_day` param.
- Every `registerTool` call across the codebase validates strictly: an unrecognized parameter fails the call instead of being dropped — at both the top level and inside any nested array-item schema.
- The resulting validation error names the offending parameter (constitution Principle IV: actionable error messages, not stack traces).

**Non-Goals:**
- Adding `due_day`/`planned_at` to `create_task`. Not asked for by issue #101; left for a separate change if wanted.
- Changing `planned_at`'s existing clearing semantics (explicit `null`, not empty-string) — deadline follows `due_day`'s convention, not `planned_at`'s.
- A shared/generic wrapper around `registerTool` to centrally enforce strictness. Each tool file applies `.strict()` (or equivalent) directly on its own schemas; see Decisions.
- Backfilling a full `tasks` capability spec covering the entire existing task tool surface (filters, tag ops, move/reorder, etc.). This change's spec capability is deliberately named `task-deadline`, scoped to only what's being added, so it doesn't misrepresent itself as the complete `tasks` spec when archived into `openspec/specs/`.

## Decisions

**Deadline field naming and clearing convention.** Mirror `due_day` exactly: `deadline_day: z.string().optional()`, mapped with `if (deadline_day !== undefined) data.deadlineDay = deadline_day || null;`. Alternative considered: a nullable field (`z.string().nullable().optional()`) like `planned_at` — rejected because `deadlineDay` is a plain date string in SP's data model (like `dueDay`), not a nullable timestamp, so the existing `due_day` convention is the closer match and keeps the two sibling params consistent for callers.

**How to enforce strictness.** Each tool's `inputSchema` must be the actual `z.object({...}).strict()` instance, not the bare raw shape — passing the raw shape would let the SDK build its own default (non-strict) `z.object()` internally, silently defeating `.strict()` even if a strict schema is exported elsewhere for tests (this was an existing latent bug in `habits.ts`: it exported `createHabitSchema`/`setHabitValueSchema` for tests but registered the bare shape instead, so the export never affected runtime behavior — fixed as part of this change). Applied independently per tool registration rather than through a shared helper, since `registerTool` calls are otherwise self-contained and a new cross-cutting wrapper would be an abstraction this change doesn't need.

**Scope of strictness: repo-wide, and nested, not just top-level `tasks.ts`.** The silent-strip behavior is identical in `projects.ts`, `tags.ts`, `habits.ts`, `notifications.ts`, and `diagnostics.ts`. Fixing only `tasks.ts` would leave the same bug class reachable from every other tool, which would look fixed without being fixed. Within `tasks.ts` itself, the nested item schemas for `bulk_update_tasks`'s `updates` array and `create_task`'s `subtasks` array must also get `.strict()` — leaving them permissive would mean a typo'd key inside a bulk update item (e.g. `deadlin_day`) still silently no-ops, which is the exact failure mode issue #101 reported, just one level deeper.

**Capability naming: `task-deadline`, not `tasks`.** Since `openspec/specs/` has no existing `tasks` capability, naming this delta's capability `tasks` would make it the *entire* archived spec for task tools, despite covering only three deadline_day requirements. Named narrowly instead; a future change can introduce a broader `tasks` capability (or rename this one) once more of the existing surface is actually specified.

## Risks / Trade-offs

- **[Breaking change]** Any existing caller sending extra/misspelled parameters to any tool, previously a silent no-op, now gets a validation error. → Documented as a breaking change in the proposal; the alternative (leaving it silent) is the bug being fixed.
- **[Regression risk]** Strict schemas can break if a tool's declared shape (top-level or nested) is missing a parameter the plugin/tests actually exercise. → Mitigated by adding a known-parameters-still-accepted test per tool (per the `mcp-tool-input-validation` spec) alongside the unknown-parameter-rejected test, so an accidentally-too-narrow schema fails tests immediately rather than surfacing as a client error later.
- **[Message-format risk]** Requiring the error to "name the offending parameter" ties the requirement to Zod's own issue-path reporting. → Zod's default `strict()` validation error already includes the unrecognized key's path in its issue list; the task/test layer just needs to surface that in the tool's returned error string rather than a generic "Invalid arguments" message.

## Migration Plan

No data migration. This is a server-side validation and schema change only:
1. Add `deadline_day` to the three task tools' schemas and handlers.
2. Apply `.strict()` to every tool's `inputSchema` across `src/tools/*.ts`, including nested array-item schemas — passing the actual schema instance to `registerTool`, not the raw shape.
3. Add/update unit tests per file, written alongside each implementation step (see tasks.md).
4. No plugin changes, no version bump beyond normal release process.

Rollback is a plain revert — no persisted state depends on the new schema shape.
