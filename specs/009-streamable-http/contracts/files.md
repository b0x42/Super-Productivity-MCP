# File Contracts: Streamable HTTP

All files live in the shared data directory (`<dataDir>`, the directory that holds `plugin_commands/` and `plugin_responses/`; resolved by `src/ipc/directories.ts`). They sit alongside the command/response protocol and do not change it (`protocolVersion` stays 1).

Every file is written **atomically** (write a temporary file in the same directory, then rename) with mode `0600`, and every reader treats the content as **untrusted**: it validates strictly and fails closed.

| File | Writer | Reader | Purpose |
|------|--------|--------|---------|
| `http_config.json` | plugin | server (and the pane, for the token only) | The validated settings, plus the token |
| `http_status.json` | server | plugin | What the server is doing; doubles as the heartbeat |
| `http_panel.json` | plugin | pane | Plain-text description of the server for the pane |
| `http_control.json` | pane | plugin | One request from the pane; deleted when read |
| `http_server.log` | launched server (stdout/stderr) | the user | Diagnostics; truncated past 512 KB at launch |
| `server/sp-mcp-http-<sha256[0:12]>.mjs` | plugin | the plugin's launch | The embedded server, content-addressed |

## Settings → `http_config.json`

Settings come from the plugin's settings form (`plugin/config-schema.json`), stored by SP as `{ "config": {...}, "savedAt": n }`.

| Setting | Type, default | Published as | Notes |
|---------|---------------|--------------|-------|
| `httpEnabled` | boolean, `false` | `enabled` | Only a literal `true` enables |
| `httpHost` | string, `127.0.0.1` | `host` | IP literal or hostname; trimmed |
| `httpPort` | integer 1–65535, `8765` | `port` | |
| `httpAllowedHosts` | string, empty | `allowedHosts` | Split on commas/whitespace; lowercase; de-duplicated; `host` or `host:port`; IPv6 bracketed |
| `httpAllowedOrigins` | string, empty | `allowedOrigins` | Split likewise; each normalized to `scheme://host[:port]` (http/https; no path, query or credentials) |
| `httpRequireToken` | boolean, `false` | `token` (present when on) | The token comes from secret storage, never from the form |
| `httpManageProcess` | boolean, `true` | — | Plugin-only: whether the plugin launches and stops the server |

```json
{ "enabled": true, "host": "0.0.0.0", "port": 8765,
  "allowedHosts": ["console.example.org"],
  "allowedOrigins": ["http://console.example.org"],
  "token": "<64 hex characters>" }
```

Any invalid field on an enabled config produces the *disabled* config (`enabled: false`, defaults, empty lists, no token) and an error message; the disabled form is also what is published when the option is off. `src/http/config.ts` and `normalizeHttpSettings` in `plugin/plugin.js` implement the same rules and are checked against each other by a round-trip test. The token is 16–256 printable non-space characters; a value that does not match is rejected without being echoed.

## `http_status.json`

```json
{ "state": "bind-failed", "host": "127.0.0.1", "port": 8765,
  "attempt": 3, "maxAttempts": 3,
  "error": "listen EADDRINUSE: address already in use 127.0.0.1:8765",
  "managed": true, "parentPid": 4242, "pid": 1234, "updatedAt": 1760000000000 }
```

| `state` | Meaning |
|---------|---------|
| `listening` | Bound and serving at `host:port` |
| `retrying` | A bind attempt failed and more remain (`attempt` of `maxAttempts`) |
| `bind-failed` | The last attempt failed; the server has stopped trying |
| `invalid-config` | `http_config.json` was rejected; `error` says why (never the token) |
| `off` | Running, nothing configured to listen |
| `stopped` | Written on a clean shutdown |

`managed` and `parentPid` are present only when the server was launched with `--parent-pid`. The file is rewritten when something changes and otherwise every 5 seconds, so **an `updatedAt` older than 20 seconds means the server is not alive**. The converse is not true: a fresh file does not prove a live process, because a server that is terminated forcibly cannot update it. The plugin therefore also remembers the pids it has stopped, for the session, and ignores any status written by one of them at or before the moment it confirmed the exit.

## `http_panel.json`

```json
{ "version": 1, "updatedAt": 1760000000000,
  "tone": "ok", "headline": "Listening on http://127.0.0.1:8765/mcp",
  "detail": "Started and managed by Super Productivity (pid 1234).",
  "url": "http://127.0.0.1:8765/mcp", "pid": 1234,
  "controls": { "restart": true, "stop": true, "start": false },
  "token": { "required": true, "present": true },
  "ack": "c8f3k2a1x9q" }
```

| Field | Notes |
|-------|-------|
| `tone` | `ok`, `warn`, `error` or `idle`: the colour of the status dot |
| `headline`, `detail` | Plain text. The pane renders them with `textContent`, so nothing is HTML-escaped here |
| `controls` | Which buttons make sense right now. All false while a launch is settling, or when the server is not the plugin's to control |
| `token` | Whether a token is required and whether one is published. **The token itself is never in this file** |
| `ack` | The `id` of the last control request the plugin handled |
| `updatedAt` | Rewritten at least every 10 seconds; the pane treats anything older than 30 seconds as stale |

## `http_control.json`

```json
{ "id": "c8f3k2a1x9q", "action": "restart", "at": 1760000000000 }
```

`action` is one of `restart`, `stop`, `start`, `rotate-token`. `id` is a string of at most 64 characters. The plugin reads and deletes the file on each poll, acts on an `id` once, discards anything malformed (an unknown action with a valid `id` is acknowledged but does nothing), then publishes the `id` as `ack`. `rotate-token` is honoured only when a token is required.

## Launching the server

The plugin installs the embedded server, then starts it from a real-process plugin script:

```
<process.execPath> --no-warnings <dataDir>/server/sp-mcp-http-<hash>.mjs --http --parent-pid <SP pid>
```

| Aspect | Value |
|--------|-------|
| Environment | `ELECTRON_RUN_AS_NODE=1`, `NODE_ENV=production`, `SP_MCP_DATA_DIR=<dataDir>` (plus `SystemRoot` on Windows). No secrets |
| Process | Detached, unreferenced, `stdio` = ignore / `http_server.log` / `http_server.log` |
| Install | The embedded bundle (gzip + base64) is uploaded in 32 KiB pieces, decompressed, checked against its SHA-256, then renamed into place; other `sp-mcp-http-*.mjs` files are deleted |
| Stop | `SIGTERM`, then `SIGKILL` after about 3 seconds; only for a pid whose fresh heartbeat says `managed` |

## Timing

| What | Value |
|------|-------|
| Plugin poll (commands, settings, control, status) | 2 s |
| Server re-reads `http_config.json` | 2 s |
| Bind attempts / spacing | 3 / 5 s |
| Server status heartbeat | 5 s |
| A heartbeat counts as alive for | 20 s |
| Grace for a just-launched server to report in | 15 s |
| Relaunches before giving up | 3 within 2 min |
| Server checks that its parent is alive | 5 s |
| Panel heartbeat / pane's stale threshold | 10 s / 30 s |
| Pane waits for an acknowledgement | 20 s |
| Request body cap | 1 MiB |

## Protocol versions and backward compatibility

The server follows [MCP specification revision 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
(Streamable HTTP), as implemented by the bundled [MCP SDK](https://github.com/modelcontextprotocol/modelcontextprotocol).
The bundled SDK revision (1.x) speaks protocol versions up to `2025-11-25`; this server reports
`2025-11-25` as its latest supported version.

| Behaviour | Rule |
|-----------|------|
| Endpoint | A single `POST /mcp` (stateless). `GET`, `DELETE` and any other method → `405 Method Not Allowed`; any other path → `404`. |
| Protocol version | Every request **should** carry `MCP-Protocol-Version`. The SDK accepts `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`, `2024-10-07`; anything else → `400` with an `UnsupportedProtocolVersionError` listing the supported versions. |
| Modern clients | A client speaking a newer revision (e.g. `2026-07-28`) is served using `2025-11-25`; the header is rewritten and a message is logged. The header and the body's `_meta.io.modelcontextprotocol/protocolVersion` must agree when both are present → `400` with error code `-32020` (`HeaderMismatch`) otherwise. |
| `Mcp-Session-Id` | Ignored on requests and never sent in responses (stateless mode). |
| `Last-Event-ID` | Ignored; streams are not resumable (there are no long-lived streams). |
| Sessions | Not used; there is no `initialize` handshake and no per-connection state. |
| Standard headers | `Mcp-Method` and `Mcp-Name` are validated against the request body when the client sends them; a mismatch → `400` with error code `-32020` (`HeaderMismatch`). |
| Notifications | A request with no `id` (a JSON-RPC notification) → `202 Accepted` with no body. |
| SSE | Requests are answered with a single JSON object (`Content-Type: application/json`). SSE streaming (`text/event-stream`) is available per the SDK but no tool requires it; `X-Accel-Buffering: no` and keep-alive comment lines are set on any SSE response. |
| HTTP+SSE | The deprecated `2024-11-05` transport is NOT supported; `GET /mcp` returns `405`. |

