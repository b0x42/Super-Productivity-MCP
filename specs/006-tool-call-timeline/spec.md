# Feature Specification: Tool Call Timeline

**Feature Branch**: `006-tool-call-timeline`
**Created**: 2026-09-01
**Status**: Draft
**Input**: A dashboard pane inside Super Productivity showing a timeline of MCP tool calls — what ran, when, how long it took, whether it succeeded — with full arguments and results captured for inspection.

## Context

Nothing in the bridge records what the assistant did. `sendCommand` deletes each
response file the moment it reads it (`src/ipc/command-sender.ts`), and
`cleanStaleFiles` purges anything older than five minutes. There is no history to
draw a timeline from, so this feature is two pieces: a recording mechanism, and a
UI to read it.

The plugin already declares `iFrame: true` in `plugin/manifest.json` but hides it
with `isSkipMenuEntry: true`, and `plugin/index.html` is a three-line stub that
renders nothing. That unused pane is where the UI goes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Recording Tool Calls (Priority: P1)

Every MCP tool invocation is appended to a durable log so there is something to
display. Recording wraps tool registration rather than the IPC layer: the IPC
layer only sees plugin actions (`getTasks`), and one tool can send several, so
IPC-level records could not tell `get_worklog` from `log_time`.

**Why this priority**: Without it there is no data. The pane is unbuildable.

**Independent Test**: Invoke a registered tool against a fake server, then read
the log file and verify one well-formed entry.

**Acceptance Scenarios**:

1. **Given** a registered tool, **When** its handler completes, **Then** one JSON line is appended containing `ts`, `tool`, `args`, `ms`, `ok`, and `result`
2. **Given** a tool returns an error result, **When** it completes, **Then** the entry has `ok: false` and carries the error message
3. **Given** a tool handler throws, **When** it is invoked, **Then** an entry is recorded with `ok: false` and the exception propagates to the client unchanged
4. **Given** the log file cannot be written, **When** a tool is invoked, **Then** the tool returns its normal result and the caller sees no error
5. **Given** a serialized payload exceeds the size cap, **When** it is recorded, **Then** it is replaced by a truncation marker stating the original byte count
6. **Given** the log holds the maximum entries, **When** a new one is recorded, **Then** the oldest is dropped

---

### User Story 2 - Viewing the Timeline (Priority: P2)

A pane inside Super Productivity lists recent tool calls newest-first, so the
user can see what the assistant did to their tasks and why something failed.

**Why this priority**: The visible deliverable, but it depends entirely on US1.

**Independent Test**: Seed a log file with known entries, open the pane, verify
the rows match.

**Acceptance Scenarios**:

1. **Given** entries exist, **When** the pane opens, **Then** each row shows local time, tool name, duration, and an ok/error badge, newest first
2. **Given** a row is clicked, **When** it expands, **Then** the recorded arguments and result are shown
3. **Given** the pane is open, **When** a new tool call is recorded, **Then** it appears within one refresh interval without manual action
4. **Given** the log is empty or absent, **When** the pane opens, **Then** an empty state is shown rather than an error
5. **Given** an entry carries a truncation marker, **When** the row expands, **Then** the pane shows the marker and byte count rather than presenting partial data as complete
6. **Given** Super Productivity is in dark mode, **When** the pane renders, **Then** it remains legible

---

### User Story 3 - Bounded Disk Use (Priority: P3)

Full request/response capture is unbounded by nature — `get_tasks` returns the
user's entire task list. The log must stay bounded without the user managing it.

**Why this priority**: Correctness of the feature over time, not first-run value.

**Independent Test**: Record more than the cap, verify line count and ordering.

**Acceptance Scenarios**:

1. **Given** more entries than the cap are recorded, **When** the file is read, **Then** it holds exactly the cap, oldest dropped
2. **Given** the log file is created, **When** its mode is checked, **Then** it is 0600
3. **Given** entries are recorded one at a time, **When** the file is under the prune threshold, **Then** no full rewrite occurs

---

### Edge Cases

- Two MCP clients each spawn a server, so two processes append to one file. Single-line appends in `O_APPEND` mode do not interleave at these sizes; pruning is read-modify-write and is last-writer-wins. What a race loses is log entries, never user data.
- A partially written or corrupt line: the pane skips unparseable lines and renders the rest.
- The log file does not exist yet (fresh install, first pane open): empty state, not an error.
- A tool with no arguments records `args: {}`, not `null`.
- A payload that is exactly at the cap is kept whole; the marker applies strictly above it.

## Requirements *(mandatory)*

### Functional Requirements — Recording

- **FR-001**: System MUST append one JSON object per line to `<base>/tool-calls.jsonl` for every MCP tool invocation
- **FR-002**: Each entry MUST contain `ts` (epoch ms), `tool` (the MCP tool name), `args`, `ms` (duration), `ok` (boolean), and either `result` or `error`
- **FR-003**: Recording MUST wrap tool registration, not the IPC layer, so entries carry MCP tool names rather than plugin action names
- **FR-004**: A recording failure MUST NOT alter or fail the tool call — the exception is caught and discarded, and the tool's own result is returned as if recording had succeeded
- **FR-005**: The wrapper MUST return the handler's result unchanged
- **FR-006**: A serialized `args` or `result` over 8192 bytes MUST be replaced by `{ _truncated: true, bytes: <n>, preview: <string> }`
- **FR-007**: The log file MUST be created at mode 0600 within the existing 0700 base directory
- **FR-008**: The log MUST retain at most 500 entries, dropping the oldest first
- **FR-009**: Pruning MUST be amortized — a full rewrite only once the file exceeds the cap by ~20%, not on every call
- **FR-010**: A tool handler that throws MUST be recorded with `ok: false` and its exception re-thrown unchanged

### Functional Requirements — Pane

- **FR-011**: The plugin MUST expose its iframe pane in Super Productivity's menu (`isSkipMenuEntry: false`)
- **FR-011a**: `plugin/manifest.json` MUST declare the `showIndexHtmlAsView` permission, which SP requires to display plugin UI at all. The manifest currently declares only `nodeExecution`
- **FR-011b**: The pane MUST read the log via the `executeNodeScript` proxied into the iframe, not via a `postMessage` bridge to `plugin.js`
- **FR-012**: The pane MUST read the log and render entries newest-first
- **FR-013**: Each row MUST show local time, tool name, duration, and success/error status
- **FR-014**: Clicking a row MUST reveal the recorded arguments and result
- **FR-015**: The pane MUST refresh on an interval matching the plugin's existing 2000 ms cadence
- **FR-016**: Unparseable lines MUST be skipped without failing the render
- **FR-017**: A missing or empty log MUST produce an empty state
- **FR-018**: The pane MUST use no external dependencies. Its JavaScript MUST be inlined into `index.html` at build time: SP serves only `index.html` to the iframe (via `srcdoc`) and does not serve arbitrary extra files from the ZIP, so a `<script src="dashboard.js">` tag fetches nothing and fails silently
- **FR-018a**: The pane MUST NOT depend on `DOMContentLoaded` still being pending when its script runs — under `srcdoc` that is undocumented, and a missed event leaves the pane permanently blank. It MUST branch on `document.readyState`
- **FR-019**: The pane MUST honour `prefers-color-scheme` so it stays legible against SP's dark theme

### Key Entities

- **ToolCallEntry**: `{ ts, tool, args, ms, ok, result? , error? }` — one line of the log
- **TruncationMarker**: `{ _truncated: true, bytes, preview }` — stands in for an oversized `args` or `result`
- **RingCap**: the retention rule — maximum entries, oldest dropped, applied on write

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A tool call appears in the open pane within 3 seconds of completing
- **SC-002**: The log file stays under ~10 MB at worst case (500 entries × two 8 KB payloads plus overhead), regardless of session length
- **SC-003**: Recording adds under 5 ms to a tool call on the append path. The amortized prune (FR-009) is exempt and MUST occur on fewer than 1 call in 100
- **SC-004**: All 34 currently registered tools are recorded without editing any of them
- **SC-005**: The existing 222 tests continue to pass unchanged

## Assumptions

- **Iframe context — resolved from SP's plugin development guide.** Iframe plugins receive a filtered `window.PluginAPI` injected into `index.html`, and `executeNodeScript` is proxied through the host bridge for iframe plugins whenever the desktop app has granted `nodeExecution` — which this plugin already requests. The pane can therefore read the log directly and needs no `postMessage` bridge. What remains host-only is callback-heavy registration (`registerHeaderButton`, `registerMenuEntry`, `registerSidePanelButton`, `registerShortcut`, `registerConfigHandler`); this feature registers none of them, so `plugin.js` keeps its current role. Implementation should still confirm the proxy responds on first run — one `executeNodeScript` call from the iframe before the UI is built on top of it — since this is documented behaviour rather than something observed in this repo.
- The stub iframe has never been reachable: SP requires the `showIndexHtmlAsView` permission to display plugin UI, and the manifest does not declare it (FR-011a). Enabling the pane means adding the permission, not just flipping `isSkipMenuEntry`.
- The original assumption that `plugin.zip` needs no build step was wrong, and cost a debugging cycle: the pane shipped with an external `<script src>` that SP never served, so it rendered its header and nothing else. `scripts/build-plugin.mjs` now inlines `plugin/dashboard.js` into `index.html` at build time. `dashboard.js` remains the source of truth and is what the unit tests import.
- Both sides already resolve the same base directory (`src/ipc/directories.ts` and the plugin's own probe), so the log needs no new path logic.
- No protocol version bump: the log is written and read outside the command/response protocol.
- Concurrent servers are tolerated, not coordinated — no lock file. Last-writer-wins on prune is acceptable for a log.
- `src/server.ts` hardcodes `version: '1.6.0'`, stale since the 1.7.0 release. It is corrected to read from `package.json` as part of this work, since the same file is being modified.
