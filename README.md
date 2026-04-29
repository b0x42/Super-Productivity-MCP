<p align="center">
  <img src="plugin/icon.svg" width="128" height="128" alt="SP MCP Bridge icon">
</p>

<h1 align="center">Super Productivity MCP Server</h1>

<p align="center">
An MCP (Model Context Protocol) server that connects AI assistants to <a href="https://super-productivity.com">Super Productivity</a> — manage tasks, projects, and tags through Claude Desktop, Kiro, or any MCP-compatible client.
</p>

## What You Can Do

**☀️ Morning Triage**
> "Show me my tasks for today and anything overdue"

The assistant retrieves your planned tasks and overdue items, presents a summary, and asks what to tackle first. Say "start the report task" and it kicks off the timer.

**🧹 Batch Inbox Cleanup**
> "Tag all my unscheduled tasks in the Work project with #backlog and set them due next Friday"

Filters unscheduled tasks, bulk-updates due dates, and adds tags — all in one conversation turn.

**🌙 End-of-Day Wrap-up**
> "What did I work on today? Complete anything I finished and show me a summary"

Pulls your worklog, stops the running timer, marks tasks done in bulk, and gives you a time summary.

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

### 3. Verify

Ask your AI assistant: *"Check the Super Productivity connection"*

## Prerequisites

- [Super Productivity](https://super-productivity.com) >= 14.0.0
- Node.js >= 18
- An MCP-compatible client (Claude Desktop, Kiro, etc.)

## Available Tools

| Tool | Description |
|------|-------------|
| `create_task` | Create a task (supports SP short syntax) |
| `get_tasks` | List tasks — filter by project, tag, done, archived, search, `parents_only`, `overdue`, `unscheduled`, `planned_for_today` |
| `update_task` | Update title, notes, done state, due date, `planned_at`, time, tags |
| `complete_task` | Mark a task as complete |
| `start_task` | Start the time tracker on a task |
| `stop_task` | Stop the currently running time tracker |
| `get_current_task` | Get the currently tracked task (null if none) |
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
| `#tag` | `Buy milk #errands` | Adds the "errands" tag |
| `+project` | `Fix bug +work` | Assigns to "work" project (prefix match, min 3 chars) |
| `@due` | `Report @friday` | Sets due date to Friday |
| `@due time` | `Call @tomorrow 3pm` | Sets due date and time |
| `30m` | `Quick fix 30m` | Sets 30-minute time estimate |
| `1h/2h` | `Research 1h/2h` | Sets 1h spent, 2h estimate |

## Troubleshooting

**Plugin not responding after install?** Toggle the plugin off and on in Settings → Plugins — this is a [known SP startup issue](https://github.com/super-productivity/super-productivity/issues/7326).

**Commands timing out?** Ask *"Show debug info for Super Productivity"* to check that both sides are using the same data directory. Mac App Store users may need to set `SP_MCP_DATA_DIR`.

→ [Full troubleshooting guide](docs/troubleshooting.md)

## License

MIT
