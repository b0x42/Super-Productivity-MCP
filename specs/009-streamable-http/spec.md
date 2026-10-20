# Feature Specification: Streamable HTTP Transport

**Feature Branch**: `009-streamable-http`
**Created**: 2026-10-17
**Status**: Draft
**Input**: User description: "Add an option in the plugin's settings to turn on a Streamable HTTP MCP server, with a configurable bind address and port. It should be off by default."

## Clarifications

### Session 2026-10-17

- Q: Should the plugin settings only describe the HTTP server, or also start it? → A: Enabling the option starts the server; disabling it stops the server. The plugin owns the process and offers restart/stop/start. `super-productivity-mcp --http` remains for setups where Super Productivity does not launch the server (a container, another machine, a service manager).
- Q: How should a bad setting be handled? → A: Fail closed — the server stays off and the plugin shows an error toast (the plugin already uses `showSnack` for this). It never falls back to a default.
- Q: What should happen when the configured port is busy? → A: Try 3 times, 5 seconds apart. If all three fail, report the error (error toast) and stop trying. The user retries with Restart, by changing a setting, or by switching the option off and on.
- Q: Is a bearer token required by default? → A: No. It is opt-in, documented and nudged as best practice (a setting description, and a warning toast when binding beyond loopback without one). When on, the plugin generates the token and keeps it in SP's local-only secret storage, because the settings form syncs between devices.
- Q: How should `Origin` behave? → A: On a loopback bind with no allowed origins configured, `Origin` is not enforced, and typical loopback origins (`localhost`, `127.x`, `[::1]`, any port) are always accepted. On any other bind, an `Origin` that is not listed is refused. Allowed hosts and allowed origins are both configurable.
- Q: Where do the server controls live? → A: In the plugin's existing pane, above the tool-call list. The plugin registers no menu entries, so it keeps a single sidebar entry (consistent with 006, which also registers none).
- Q: Should the plugin accept a user-supplied path or command for the server? → A: No. Settings sync between devices, so it would let anything that can write to the sync backend run code on every device where the plugin is installed, and a path is machine-specific anyway. The plugin ships its own server instead.

## Context

stdio is the only transport: the MCP client spawns `super-productivity-mcp` per session, which ties one server process to one client and rules out clients on another machine or in a container.

Four facts about Super Productivity (SP) shape the design:

1. **Settings.** When the manifest sets `jsonSchemaCfg`, SP renders a settings form. Saved values land in the plugin's *synced* data as `{ "config": {...}, "savedAt": n }`, readable with `PluginAPI.loadSyncedData()`. Synced means other devices, exports and backups.
2. **Plugin scripts.** `PluginAPI.executeNodeScript` runs in one of two modes (SP's `electron/plugin-node-executor.ts`): a script matching a "dangerous" pattern (`require` of anything but fs/path/os, `child_process`, `exec`, `spawn`, `eval`, `Function`, `process.exit`) runs in a real child process (`process.execPath` with `ELECTRON_RUN_AS_NODE=1`, a stripped environment, **no `PATH`**); every other script runs in a vm sandbox with only fs/path/os and **no `process`**. A script is capped at 100 KB, arguments included. A detached grandchild started from the real-process mode outlives the script.
3. **Secrets.** `PluginAPI.setSecret/getSecret/deleteSecret` store values locally: never synced, exported or backed up. The settings form cannot write to it.
4. **The pane.** The pane is an iframe with a filtered `PluginAPI`: `executeNodeScript` is proxied, but it has no secret storage and no documented route to `plugin.js`. 006 already relies on this and uses `executeNodeScript` to read files.

So the settings are the **control plane**, the plugin is the **process manager**, and the server's `--http` mode is the **data plane**. They communicate through files in the shared data directory, the same channel as the command protocol (see `contracts/files.md`):

```
SP settings ──▶ plugin.js ──▶ http_config.json ──▶ server (--http)
                  │  ▲                                  │ follows live
                  │  └────────── http_status.json ◀─────┘ (state, errors, heartbeat)
                  │ launches / stops (embedded bundle, SP's own Node)
                  ▼
        http_panel.json ──▶ pane ──▶ http_control.json ──▶ plugin.js
```

The server ships inside `plugin.js` (a fully bundled build, gzip + base64), is written to `<dataDir>/server/` on first use and is launched detached, so no `PATH`, `npx` or separate install is needed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Turn on HTTP from the plugin settings (Priority: P1)

A user wants MCP clients to connect over HTTP instead of spawning a stdio process. They open the plugin settings, tick **Enable Streamable HTTP server**, optionally change the bind address or port, and point a client at `http://<address>:<port>/mcp`.

**Why this priority**: This is the feature. Everything else makes it manageable or safe.

**Independent Test**: With a plugin build that embeds the server, enable the option, wait for the server to report `listening`, then send `tools/list` to `POST /mcp` and compare the result with the stdio server's tool list.

**Acceptance Scenarios**:

1. **Given** a fresh install (settings never opened), **When** SP and the plugin start, **Then** nothing is listening and no server process exists.
2. **Given** the option is enabled with default settings, **When** the plugin next polls, **Then** a server is launched and `POST http://127.0.0.1:8765/mcp` serves the same tools and resources as stdio.
3. **Given** a running server, **When** the bind address, port, allowed hosts, allowed origins or token setting changes, **Then** the listener is rebound or reconfigured within a few seconds, without restarting the process.
4. **Given** a running server, **When** the option is switched off, **Then** the listener closes and the server process stops.
5. **Given** the option is enabled with an invalid bind address, port, allowed host or allowed origin, **When** the settings are saved, **Then** the server stays off, an error toast names the problem, and no default is substituted.
6. **Given** the plugin is run from a source checkout (no embedded server), **When** the option is enabled, **Then** the settings are still published and the user is told to run `super-productivity-mcp --http` themselves.

---

### User Story 2 - Manage the server from the plugin's page (Priority: P2)

The user opens the plugin's page in SP and sees an **MCP HTTP server** panel above the tool calls. It says what the server is doing in words, and lets them restart, stop and start it without leaving SP.

**Why this priority**: Without it a failure (busy port, crash) is invisible and recovery means a terminal.

**Independent Test**: Occupy the configured port, enable the option, and watch the panel report the failure after the third attempt; free the port and press Restart.

**Acceptance Scenarios**:

1. **Given** a running server, **When** the pane is open, **Then** the panel shows where it is listening and offers Restart and Stop.
2. **Given** the configured port is in use, **When** the server starts, **Then** it tries 3 times, 5 seconds apart, then reports the error (panel and one error toast) and makes no further attempts on its own.
3. **Given** the server has given up on a busy port, **When** the user frees the port and presses Restart, **Then** the server starts and the panel shows it listening.
4. **Given** the user pressed Stop, **When** SP keeps polling, **Then** the server is not relaunched until the user presses Start or switches the option off and on.
5. **Given** Super Productivity quits or crashes, **When** a few seconds pass, **Then** the server process has exited by itself.
6. **Given** the server process keeps dying, **When** it has been relaunched 3 times within 2 minutes, **Then** the plugin stops relaunching it and tells the user where `http_server.log` is.
7. **Given** a server that someone else started (not by the plugin), **When** the option is enabled, **Then** the plugin does not start a second one, never signals it, and says so once.
8. **Given** the plugin stops reporting, **When** the panel's information is more than 30 seconds old, **Then** the panel says it may be out of date and its Restart/Stop/New token controls are disabled.
9. **Given** the user presses a button, **When** the plugin has not yet acknowledged it, **Then** the button shows progress ("Restarting…") and is disabled, giving up after 20 seconds.
10. **Given** the user pressed Stop or Restart, **When** the plugin acknowledges, **Then** the panel already shows the new state (Stopped, or Starting…), never the old server as still listening, including where the server cannot write a final status.

---

### User Story 3 - Control who can use the endpoint (Priority: P3)

The endpoint can read and change every task. The user can restrict it by `Host`, by browser `Origin`, and with a bearer token.

**Why this priority**: The defaults (loopback bind) are already safe; this matters once the user binds beyond loopback or uses a browser-based client.

**Independent Test**: Bind to `0.0.0.0` with an allowed host, an allowed origin and a token, then check each of: wrong Host, wrong Origin, missing token, correct everything.

**Acceptance Scenarios**:

1. **Given** the default loopback bind, **When** a request arrives with a `Host` other than `localhost`, `127.0.0.1` or `[::1]` (or an allowed host), **Then** it is refused with 403.
2. **Given** a non-loopback bind with allowed hosts configured, **When** a request arrives with an unlisted `Host`, **Then** it is refused; with no allowed hosts configured, the server logs that Host is not validated.
3. **Given** a loopback bind and no allowed origins, **When** a browser page sends a request, **Then** it is not refused on Origin grounds, and pages served from `localhost`/`127.x`/`[::1]` get CORS access.
4. **Given** a non-loopback bind, or a loopback bind with allowed origins configured, **When** a request carries an unlisted `Origin`, **Then** it is refused with 403 and never receives a CORS grant.
5. **Given** an allowed origin, **When** its page sends a CORS preflight, **Then** the preflight succeeds without a token and the actual request still needs one.
6. **Given** *Require bearer token* is on, **When** the server first starts, **Then** the plugin generates a token, keeps it in local-only secret storage, and shows it once.
7. **Given** a token is required, **When** a request lacks the right `Authorization: Bearer <token>`, **Then** it is refused with 401.
8. **Given** the user presses **New token** and confirms, **When** the plugin acknowledges, **Then** the old token stops working and the new one works, within a few seconds.
9. **Given** a bind beyond loopback without a token, **When** the option is enabled, **Then** the server logs a warning and the plugin shows a warning toast naming the token as best practice.

---

### User Story 4 - Run the server yourself (Priority: P4)

For a container, another machine or a service manager, the user turns off *Start and stop the server from Super Productivity* and runs `super-productivity-mcp --http` themselves. It follows the same plugin settings through the shared data directory.

**Why this priority**: The default flow covers a desktop user; this keeps headless setups possible.

**Independent Test**: Run `super-productivity-mcp --http` with `SP_MCP_DATA_DIR` pointing at a temporary directory, write an enabled `http_config.json`, and observe the listener open, rebind and close as the file changes.

**Acceptance Scenarios**:

1. **Given** `--http` is running and no config exists (or the option is off), **When** nothing else happens, **Then** it binds nothing.
2. **Given** `--http` is running, **When** `http_config.json` is enabled, changed or disabled, **Then** the listener follows within a few seconds.
3. **Given** `SP_MCP_HTTP_TOKEN` is set in the server's environment, **When** the config also carries a token, **Then** the environment value wins.
4. **Given** the plugin did not start this server, **When** the panel shows it, **Then** it is labelled as running outside Super Productivity and no Restart/Stop is offered.

---

### Edge Cases

- `http_config.json` is corrupt, hand-edited to something invalid, or has a token that is too short: the server closes any listener, reports `invalid-config`, and never echoes the token.
- The settings change while the server is still retrying a busy port: a new round of three attempts starts.
- The embedded server fails its integrity check on install: nothing runnable is left behind, the plugin reports the error and does not retry until the user acts or changes a setting.
- Secret storage is unavailable (older SP) while a token is required: fail closed — the server stays off, with an explanatory toast.
- The clipboard is not available to the pane: **Copy** falls back to showing the token so it can be selected by hand.
- A status file left behind by an earlier launch (a `bind-failed` verdict older than the latest launch) is not reported again.
- A heartbeat older than 20 seconds means "not alive": the plugin never signals a pid it cannot confirm is its own server, because pids are reused. Conversely a process the plugin has just stopped is not alive even if its last status is fresh, and the plugin does not signal that pid a second time.
- A managed server whose recorded parent is not the current SP process is a leftover from an earlier session and is replaced rather than adopted.
- A request body over 1 MiB, malformed JSON, `GET`/`DELETE`, and any path other than `/mcp` each get a specific refusal (413, 400, 405, 404) and never crash the server.
- stdio and HTTP can run side by side; stdio behaviour is unchanged.

## Requirements *(mandatory)*

### Functional Requirements — Settings

- **FR-001**: The plugin settings MUST provide: `httpEnabled` (default **off**), `httpHost` (default `127.0.0.1`), `httpPort` (default `8765`), `httpManageProcess` (default **on**), `httpRequireToken` (default **off**; described as best practice and recommended beyond loopback), `httpAllowedHosts` and `httpAllowedOrigins` (free text, comma/space separated, default empty).
- **FR-002**: With no saved settings, no config file, or an unreadable or invalid one, no listener MUST be opened. Invalid input (address, port, host list, origin list, token) MUST fail closed — server off, error toast — and MUST NOT fall back to a default.

### Functional Requirements — Server

- **FR-003**: `--http` MUST follow `http_config.json` live: open the listener when enabled, close it when disabled, rebind or reconfigure when any field changes, with no restart.
- **FR-004**: The endpoint MUST be `POST /mcp` (Streamable HTTP, stateless, JSON responses). `GET`/`DELETE` MUST return 405, other paths 404, bodies over 1 MiB 413, malformed JSON 400.
- **FR-005**: The tool and resource set MUST be identical to stdio's.
- **FR-006 (Host)**: A loopback bind MUST always validate `Host` against the loopback names (with the bound port) plus `allowedHosts`. Other binds MUST validate only when `allowedHosts` is non-empty, and otherwise log a note. An entry without a port matches any port. Comparison is case-insensitive; IPv6 is bracketed.
- **FR-007 (Origin)**: A request without `Origin` MUST be unaffected. With one, it is allowed if it is in `allowedOrigins` (normalized full origins) or, **on a loopback bind only**, is itself a loopback origin (`localhost`, `127.x`, `[::1]`, any port). A loopback bind with an **empty** list MUST NOT enforce Origin; with a non-empty list other Origins get 403. Non-loopback binds MUST always enforce. An origin that is not allowed MUST NOT receive a CORS grant.
- **FR-008 (CORS)**: For an allowed Origin, preflights MUST be answered with 204 before the token check, and responses MUST carry `Access-Control-Allow-Origin` and `Vary: Origin`.
- **FR-009 (Bind retry)**: A failed bind MUST be attempted **3 times, 5 seconds apart**. Earlier misses are state `retrying`; after the third the server MUST report `bind-failed` and stop trying. A fresh round starts when any setting changes, the option is switched off and on, or the process is restarted. A failed bind MUST NOT crash the process.
- **FR-010**: The server MUST publish `http_status.json` (owner-only) with `state` ∈ `listening | retrying | bind-failed | invalid-config | off | stopped`, the bind, the error and attempt counts, `pid`, `managed`, `parentPid`, and an `updatedAt` refreshed at least every 5 seconds (heartbeat).
- **FR-011**: `--parent-pid <n>` MUST make the server exit when that process disappears (checked every 5 seconds), so a plugin-launched server cannot outlive SP.

### Functional Requirements — Token

- **FR-012**: With `httpRequireToken` on, the plugin MUST generate a 256-bit token on first need, store it with `setSecret`, and publish it in `http_config.json` (owner-only). The server MUST then require `Authorization: Bearer <token>`. `SP_MCP_HTTP_TOKEN` in the server's environment MUST take precedence. The token MUST NOT be logged, toasted, placed on a command line, written to synced settings, or included in the panel file. If a token is required but cannot be obtained, the server stays off with an error toast.
- **FR-013**: Binding beyond loopback without a token MUST log a server warning and show a plugin warning toast.

### Functional Requirements — Protocol (MCP 2026-07-28 Streamable HTTP)

- **FR-023**: The endpoint MUST be a single stateless `POST /mcp`. `GET` and `DELETE` MUST return `405 Method Not Allowed`; any other path `404`; any other method `405`.
- **FR-024**: Every request **should** carry `MCP-Protocol-Version`. The SDK-supported revisions (`2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`, `2024-10-07`) are accepted; anything else → `400` `UnsupportedProtocolVersionError` listing the supported versions. A request without the header is treated as `2025-03-26` (legacy clients).
- **FR-025**: A client speaking a newer revision (e.g. `2026-07-28`) is served using `2025-11-25`; the header is rewritten and a message is logged. The header and the body's `_meta.io.modelcontextprotocol/protocolVersion` MUST agree when both are present → `400` with error code `-32020` (`HeaderMismatch`).
- **FR-026**: Standard headers `Mcp-Method` and `Mcp-Name` MUST be validated against the request body when the client sends them; a mismatch → `400` with error code `-32020` (`HeaderMismatch`). Clients that omit them (older revisions) are served leniently.
- **FR-027**: `Mcp-Session-Id` on requests MUST be ignored and never sent in responses; `Last-Event-ID` MUST be ignored; streams are not resumable. There are no sessions and the `initialize` handshake is tolerated but never required.
- **FR-028**: A JSON-RPC notification (no `id`) MUST be answered with `202 Accepted` and no body.
- **FR-029**: `server/discover` MUST be implemented, reporting the latest supported protocol version, instructions and capabilities (`tools.listChanged`, `resources.listChanged`).

### Functional Requirements — Process management

- **FR-014**: With `httpManageProcess` on and a plugin build that embeds the server, enabling the option MUST launch the server (after publishing the settings) and disabling it MUST stop it. The launch MUST use `process.execPath` with `ELECTRON_RUN_AS_NODE`, detached, output appended to `http_server.log` (truncated past 512 KB), and pass nothing but the data directory and `--parent-pid` — no secrets.
- **FR-015**: The embedded server MUST be installed content-addressed and verified by SHA-256 before it receives its final name; older versions are removed; the upload is chunked under SP's script cap.
- **FR-016**: Liveness MUST be the status heartbeat (younger than 20 seconds), not a pid probe. The plugin MUST signal only a pid that a fresh heartbeat identifies as a *managed* server, MUST NOT signal a server it did not start, and MUST say once that it is leaving one alone. A pid the plugin has itself stopped and confirmed gone MUST be treated as not alive immediately, whatever its status file still says (a server cannot write a final `stopped` when it is terminated forcibly); a status written after that point, such as by a new server that happens to reuse the pid, is believed again.
- **FR-017**: A managed server whose `parentPid` is not this SP process MUST be replaced, not adopted.
- **FR-018**: A dead server MUST be relaunched at most 3 times within 2 minutes; then the plugin stops and tells the user where `http_server.log` is. A just-launched server gets 15 seconds to report in.

### Functional Requirements — Pane

- **FR-019**: The plugin's existing pane MUST show an **MCP HTTP server** panel above the tool-call list (the plugin keeps a single sidebar entry and registers no menu entries). It shows the state in words and offers Restart, Stop and Start as applicable. Stop is sticky until Start, or until the option is switched off and on. Restart resets the retry and relaunch limits and is the standard way to retry after a bind failure. On plugin unload the managed server is stopped.
- **FR-020**: A `bind-failed` verdict MUST be shown once as an error toast saying the server stopped trying and how to retry. A verdict older than the latest launch MUST NOT be re-reported.
- **FR-021**: The panel's token row (only when a token is required) MUST mask the token. **Show** reveals it, **Copy** copies it (falling back to showing it when the clipboard is blocked), **New token** replaces it after a second confirming click, and the replacement is published immediately.
- **FR-022 (Pane ↔ plugin protocol)**: The plugin MUST publish `http_panel.json` (plain-text view model; never the token; rewritten on change and at least every 10 seconds). The pane MUST send requests by writing `http_control.json` (`{id, action}`, action ∈ `restart | stop | start | rotate-token`, atomic, owner-only). The plugin MUST consume the file each poll, act on each id once, ignore anything malformed, and acknowledge via `ack`. The pane MUST disable buttons until acknowledged (20-second cap) and treat a panel older than 30 seconds as stale. File formats are in `contracts/files.md`.

### Key Entities *(include if feature involves data)*

- **Settings**: the seven `http*` values in `plugin/config-schema.json`, stored by SP (synced).
- **Published config** (`http_config.json`): the validated, normalized form of the settings plus the token; read by the server.
- **Status** (`http_status.json`): what the server is doing and whether it is alive; read by the plugin.
- **Panel model** (`http_panel.json`): the plugin's plain-text description of the server for the pane.
- **Control request** (`http_control.json`): one request from the pane to the plugin.
- **Embedded server**: the fully bundled server inside `plugin.js`, installed to `<dataDir>/server/`.
- **Bearer token**: a credential held in SP's local-only secret storage and delivered to the server in the published config.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a fresh install nothing listens and no server process exists.
- **SC-002**: After the option is enabled, the server is serving within about 10 seconds (one poll interval plus launch).
- **SC-003**: A settings change reaches a running server within about 4 seconds, without a process restart.
- **SC-004**: A busy port produces exactly 3 attempts over about 10 seconds, one error toast, and no further attempts until the user acts.
- **SC-005**: After SP exits, a plugin-launched server is gone within about 10 seconds.
- **SC-006**: Steady-state polling spawns no additional process: every script the plugin runs on each poll executes in SP's sandbox mode.
- **SC-007**: stdio behaviour is unchanged. Every test that predates this feature passes unchanged, apart from the version test's pattern being widened to allow a pre-release suffix.

## Assumptions

- **SP behaviour is taken from SP's source and plugin guide** (`plugin-node-executor.ts`, `plugin-iframe.util.ts`, the plugin API types): the two executor modes, the iframe's API allow-list, secret storage, and the size limits (5 MB per plugin file, 10 MB per zip). The test suite reproduces the executor's mode selection and sandbox so a script that only works by accident fails in CI rather than inside SP, and an integration test (`tests/integration/http-managed.test.ts`) drives the real pane, plugin and bundled server together through that replica. Behaviour inside a running SP — the settings form, dialogs, clipboard access from the iframe — is assumed from that documentation.
- **`ELECTRON_RUN_AS_NODE` works on every supported platform.** SP's own executor depends on it; the plugin launches the server the same way.
- **Windows** has no graceful `SIGTERM`: stopping the server there is a forced termination, so no final `stopped` status is written. The plugin therefore records the pids it has stopped (FR-016) so the panel reads "Stopped" at once rather than after the heartbeat expires; a server that dies on its own is still noticed within 20 seconds.
- **Clocks**: the plugin compares `updatedAt` timestamps written by the server on the same machine, so no clock-skew handling is needed. A server on another machine that shares the data directory over a network mount is supported only to the extent the mount keeps clocks close.
- **Synced settings are not secret.** Nothing sensitive is ever put in `config-schema.json` fields; the only credential has its own path (FR-012).
- **Out of scope**: running the server inside SP's own process; a user-supplied server path or command (see Clarifications); TLS and multi-user authentication (use a reverse proxy, tunnel or VPN); sessions and server push (no tool emits notifications); restarting a server the plugin did not start.
- **Versioning**: no protocol version bump — the new files sit alongside the command/response protocol and do not change it. Data-directory discovery in `src/ipc/directories.ts` is reused unchanged.
