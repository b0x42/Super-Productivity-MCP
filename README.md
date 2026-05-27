<p align="center">
  <img src="plugin/icon.svg" width="128" height="128" alt="SP MCP Bridge icon">
</p>

<h1 align="center">Super Productivity MCP Server</h1>

<p align="center">
An MCP (Model Context Protocol) server that connects AI assistants to <a href="https://super-productivity.com">Super Productivity</a> — manage tasks, projects, and tags through Claude Desktop, Kiro, or any MCP-compatible client.
</p>

## What You Can Do

**✅ Quick Capture**
> "Add a task: Buy milk #shopping @tomorrow 15m"

Parses the tag, due date, and time estimate from short syntax — one shot, no follow-up needed.

**🧹 Batch Triage**
> "Show me all unscheduled tasks in my Work project, tag them #backlog, and set them due next Friday"

Filters, bulk-updates due dates, and adds tags — all in one conversation turn.

**🧠 Full Planning Session**
> "Look at my week: show today's plan and anything overdue. Break 'Launch blog' into subtasks, start the first one, and move anything I finished yesterday to done. Give me a time summary when you're done."

Reads resources for context, creates subtasks in batch, starts the timer, bulk-completes tasks, pulls the worklog, and summarizes — a multi-step workflow in a single prompt.

→ [More use cases](docs/use-cases.md)

## Installation

### 1. Install the SP Plugin

**Option A — via npx:**
```bash
npx -y super-productivity-mcp@latest --extract-plugin
```

**Option B — manual download:**
Download `plugin.zip` from the [latest release](https://github.com/b0x42/Super-Productivity-MCP/releases/latest).

Then in Super Productivity: **Settings → Plugins → Upload Plugin**, select `plugin.zip`, restart SP.

### 2. Configure Your MCP Client

```json
{
  "mcpServers": {
    "super-productivity": {
      "command": "npx",
      "args": ["-y", "super-productivity-mcp"]
    }
  }
}
```

Config file locations:
- **Claude Desktop (macOS):** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Claude Desktop (Windows):** `%APPDATA%\Claude\claude_desktop_config.json`

For **Claude Code**, don't edit the config file by hand — use the CLI:

```bash
# user scope (everywhere), project scope (-s project), or local scope (default)
claude mcp add -s user super-productivity npx -- -y super-productivity-mcp
```

To verify, run `claude mcp list`. Restart the session to load the server. Swap `npx -- -y super-productivity-mcp` for `super-productivity-mcp` (global install) or `node /absolute/path/to/dist/index.js` (from source) — see [Running without npx](#running-without-npx).

### 3. Verify

Ask your AI assistant: *"Check the Super Productivity connection"*

## Running without npx

`npx` is convenient but fetches the package on every cold cache and needs network access. If you'd rather pin a local copy, pick one of the options below.

### Option A — Global install

```bash
npm install -g super-productivity-mcp
super-productivity-mcp --extract-plugin   # optional: write plugin.zip to cwd
```

Then point your MCP client at the installed binary:

```json
{
  "mcpServers": {
    "super-productivity": {
      "command": "super-productivity-mcp"
    }
  }
}
```

If the binary isn't found, your MCP client may not inherit your shell's `PATH`. Use the absolute path from `which super-productivity-mcp` as `command` — or, if `which` doesn't resolve it, point at `$(npm config get prefix)/bin/super-productivity-mcp` (on macOS/Linux).

### Option B — From source

```bash
git clone https://github.com/b0x42/Super-Productivity-MCP.git
cd Super-Productivity-MCP
npm install
npm run build              # produces dist/index.js and dist/plugin.zip
```

Then run the server directly with `node`:

```json
{
  "mcpServers": {
    "super-productivity": {
      "command": "node",
      "args": ["/absolute/path/to/Super-Productivity-MCP/dist/index.js"]
    }
  }
}
```

The plugin to upload to Super Productivity is at `dist/plugin.zip` after `npm run build`.

## Prerequisites

- [Super Productivity](https://super-productivity.com) >= 14.0.0
- Node.js >= 18
- An MCP-compatible client (Claude Desktop, Kiro, etc.)

## Available Tools

| Tool | Description |
|------|-------------|
| `create_task` | Create a task (supports SP short syntax) |
| `create_task_with_subtasks` | Create a parent task + subtasks in one operation |
| `get_tasks` | List tasks — filter by project, tag, done, archived, search (title+notes), `parents_only`, `overdue`, `unscheduled`, `planned_for_today`, `recurring_only`, `fields` |
| `update_task` | Update title, notes, done state, due date, `planned_at`, time, tags |
| `complete_task` | Mark a task as complete |
| `delete_task` | Permanently delete a task (parent deletes subtasks too) |
| `start_task` | Start the time tracker on a task |
| `stop_task` | Stop the currently running time tracker |
| `get_current_task` | Get the currently tracked task (null if none) |
| `plan_tasks_for_today` | Batch plan/unplan tasks for today ⚠️ [limited](#known-limitations) |
| `bulk_complete_tasks` | Mark multiple tasks complete in one operation |
| `bulk_update_tasks` | Update multiple tasks in one operation |
| `add_tag_to_task` | Add a tag without replacing other tags |
| `remove_tag_from_task` | Remove a single tag |
| `move_task_to_project` | Move a top-level task to a different project |
| `reorder_tasks` | Reorder tasks within a project or parent |
| `get_projects` | List all projects |
| `create_project` | Create a new project |
| `update_project` | Update project properties |
| `get_tags` | List all tags |
| `create_tag` | Create a new tag |
| `update_tag` | Update tag properties |
| `get_worklog` | Time tracking summary for a date range |
| `show_notification` | Show a snackbar in SP's UI |
| `check_connection` | Verify SP is running and the plugin is responding |
| `debug_directories` | Show resolved data directory paths |

## SP Short Syntax

Include these in task titles and they are parsed automatically:

| Syntax | Example | Effect |
|--------|---------|--------|
| `#tag` | `Buy milk #shopping` | Adds the "shopping" tag |
| `+project` | `Fix bug +work` | Assigns to "work" project (prefix match, min 3 chars) |
| `@due` | `Report @friday` | Sets due date to Friday |
| `@due time` | `Call @tomorrow 3pm` | Sets due date and time |
| `30m` | `Quick fix 30m` | Sets 30-minute time estimate |
| `1h/2h` | `Research 1h/2h` | Sets 1h spent, 2h estimate |

## Troubleshooting

**Plugin not loading?** Update to SP ≥ 18.6.0 — older versions have a cold-boot race that can prevent the plugin from initializing. On SP ≥ 18.6.0 this is fixed and no restart is needed; just **toggle the plugin off and on** in Settings → Plugins. On older versions, a restart after toggling may help.

**Commands timing out?** Ask *"Show debug info for Super Productivity"* to check that both sides are using the same data directory. Mac App Store users may need to set `SP_MCP_DATA_DIR`.

→ [Full troubleshooting guide](docs/troubleshooting.md)

## Known Limitations

| Tool | Issue | Status |
|------|-------|--------|
| `plan_tasks_for_today` | Sets `plannedAt` on the task but does not add it to SP's internal Planner store, so the task may not appear in the Today view. | Upstream request: [super-productivity#7495](https://github.com/super-productivity/super-productivity/issues/7495) |

## License

MIT
