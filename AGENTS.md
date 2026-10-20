# Agent Instructions

> `CLAUDE.md` is a symlink to this file for Claude Code compatibility.

## Commands

```bash
npm run build        # compile MCP server (tsup) + zip plugin → dist/plugin.zip
npm run build:server # tsup only — dist/index.js
npm run build:plugin # inline the pane into index.html, then zip → dist/plugin.zip
npm run dev          # watch mode
npm test             # vitest run
npm run test:watch   # vitest watch
npm run typecheck    # tsc --noEmit (use this, not npx tsc — tsc not in PATH)
npm run lint         # eslint src/
```

A Makefile wraps these; the npm scripts stay the source of truth (CI and
`prepublishOnly` call them directly). What it adds is dependency tracking —
`dist/index.js` and `dist/plugin.zip` are real file targets, so an unchanged
tree rebuilds nothing.

```bash
make                 # build both artifacts
make verify          # typecheck + lint + test — the pre-commit gate
make mcp-add         # register with Claude Code (SCOPE=local to override)
make mcp-remove
make clean
```

## Architecture

Two components communicating via file-based IPC:

- **MCP server** (`src/`) — TypeScript, built with tsup
- **SP plugin** (`plugin/`) — JavaScript + HTML, loaded into Super Productivity

Plugin writes responses to `plugin_responses/`, server reads. Server writes commands to `plugin_commands/`, plugin polls.

```
src/
  ipc/
    command-sender.ts   # sendCommand() — writes command file, polls for response
    directories.ts      # platform-aware IPC dir discovery (macOS/Linux/Windows/snap)
    types.ts            # shared types (TaskFilters, Command, etc.)
  http/                 # optional Streamable HTTP transport (`--http`), off by default
    config.ts           # http_config.json schema + fail-closed validation
    listener.ts         # POST /mcp, stateless; bearer token, Host check, body cap
    parent.ts           # --parent-pid: exit when Super Productivity does
    status.ts           # http_status.json writer — state, errors, heartbeat
    supervisor.ts       # polls http_config.json; opens/closes/rebinds the listener live
  tools/
    tasks.ts            # get_tasks, create_task, update_task, reorder_tasks, …
    projects.ts         # get_projects, create_project, update_project
    tags.ts             # get_tags, create_tag, update_tag
    habits.ts           # get_habits, create_habit, update_habit, check_habit, set_habit_value, delete_habit
    habit-streak.ts     # streak computation, ported from SP's own algorithm (pure, unit-tested)
    notifications.ts    # show_notification
    diagnostics.ts      # debug tool
    result.ts           # okResult() / errorResult() helpers
  server.ts             # registers all tools
  index.ts              # entry point
plugin/
  plugin.js             # SP plugin — handles all MCP commands, calls PluginAPI
  dashboard.js          # pane UI: tool-call timeline + HTTP server panel (inlined into index.html at build)
  config-schema.json    # settings dialog (manifest.jsonSchemaCfg): the http* settings
tests/
  unit/tools/           # vitest unit tests
```

## Key Patterns

Tools follow this shape:

```ts
server.registerTool('tool_name', { description, inputSchema }, async (args) => {
  const res = await sendCommand(dirs, 'spAction', { ...args });
  if (!res.success) return errorResult(res.error ?? 'Failed');
  return okResult({ ... });
});
```

SP has no IndexedDB indexes on `tagIds`/`projectId` — filtering is always O(n) and done server-side after `getTasks()`.

The optional HTTP transport (`specs/009-streamable-http`, `docs/streamable-http.md`) is driven entirely through files in the data directory — see `specs/009-streamable-http/contracts/files.md`. `plugin.js` publishes the settings as `http_config.json`, which the `--http` server follows live; the server answers with `http_status.json` (state, errors, heartbeat). `src/http/config.ts` and `normalizeHttpSettings` in `plugin.js` validate the same rules — change both together (a parity test enforces it).

The plugin also launches and supervises that server. `scripts/build-plugin.mjs` embeds `dist/server-http.mjs` (the server bundled with its dependencies, `tsup.embedded.config.ts`) into `plugin.js`, which installs it under `<dataDir>/server/` and starts it detached with `process.execPath` + `ELECTRON_RUN_AS_NODE`. Liveness is the status heartbeat, never a bare pid probe, and the server exits with `--parent-pid`.

The controls are a panel at the top of the existing pane. The pane's iframe can't reach `plugin.js` or secret storage, so the plugin publishes `http_panel.json` (a plain-text view model) and the pane sends requests as `http_control.json`. Keep decisions in the pure functions (`panelView`, `buildPanelModel`) and the DOM code dumb. The plugin registers no menu entries: one sidebar icon.

The bearer token never goes through the settings form (it syncs): the plugin keeps it in `PluginAPI.setSecret` and publishes it in the owner-only `http_config.json`.

## Gotchas

- `npx tsc` pulls a wrong package — always use `npm run typecheck`
- SP runs `executeNodeScript` in two modes: a script matching `/require\((?!fs|path|os)|child_process|exec|spawn|eval|Function|process\.exit/` gets a real child process (stripped env, no `PATH`); anything else runs in a vm sandbox with only fs/path/os and **no `process`**. Steady-state polling must stay sandbox-safe; scripts needing `process` start with `const process = require('process')`. `tests/unit/plugin/helpers/spExecutor.ts` replicates this — run plugin scripts through it.
- A script is capped at 100KB (args travel inside it); stream anything bigger in chunks (see `ensureServerBundle`)
- `tests/integration/http-managed.test.ts` drives the real pane (jsdom), the plugin and the bundled server together, so it needs `dist/server-http.mjs` (`npm run build`, which CI runs before testing) and is skipped without it, and on Windows. It takes about a minute. Tests that start the server must pass `candidatePaths: []` (or inject `dirs`) to `startHttpMode`/`resolveDirectories`, or they write `mcp_config.json` into the developer's real per-user data directories
- The settings form (`jsonSchemaCfg`) is synced state: never put a secret in it. Secrets go through `PluginAPI.setSecret` (local-only).
- `npm run build` produces the artifacts: `dist/index.js`, `dist/server-http.mjs` (the self-contained server that gets embedded into `plugin.js`) and `dist/plugin.zip` — `build:server`/`tsup` alone only produces `dist/index.js`. Use `build:server` when you deliberately only need the server rebuilt; use `build` (or `make build`) for a deployable plugin zip. `build:plugin` needs `dist/server-http.mjs` (`build:embedded`) first and the `zip` command on `PATH`
- TypeScript 6 requires `"types": ["node"]` in tsconfig (already set) — removing it breaks all `node:` imports

## Specs

For feature specifications and implementation plans, see `specs/` directory.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->
