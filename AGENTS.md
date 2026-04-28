# Agent Instructions

> Also available as [CLAUDE.md](CLAUDE.md) for Claude Code compatibility.

## Commands

```bash
npm run build        # compile MCP server (tsup) + zip plugin → dist/plugin.zip
npm run dev          # watch mode
npm test             # vitest run
npm run test:watch   # vitest watch
npm run typecheck    # tsc --noEmit (use this, not npx tsc — tsc not in PATH)
npm run lint         # eslint src/
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
  tools/
    tasks.ts            # get_tasks, create_task, update_task, reorder_tasks, …
    projects.ts         # get_projects, create_project, update_project
    tags.ts             # get_tags, create_tag, update_tag
    notifications.ts    # show_notification
    diagnostics.ts      # debug tool
    result.ts           # okResult() / errorResult() helpers
  server.ts             # registers all tools
  index.ts              # entry point
plugin/
  plugin.js             # SP plugin — handles all MCP commands, calls PluginAPI
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

## Gotchas

- `npx tsc` pulls a wrong package — always use `npm run typecheck`
- `npm run build` also runs `build:plugin` (zips `plugin/` → `dist/plugin.zip`) — don't run tsup alone
- TypeScript 6 requires `"types": ["node"]` in tsconfig (already set) — removing it breaks all `node:` imports

## Specs

For feature specifications and implementation plans, see `specs/` directory.
