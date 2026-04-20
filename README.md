# Super Productivity MCP Server

An MCP (Model Context Protocol) server that connects AI assistants to [Super Productivity](https://super-productivity.com) — manage tasks, projects, and tags through Claude Desktop, Kiro, or any MCP-compatible client.

## Features

- **Task Management**: Create, list, update, and complete tasks
- **Project & Tag Management**: Create, list, and update projects and tags
- **SP Short Syntax**: Full support for `#tags`, `+projects`, `@due-dates`, and time estimates (`30m`, `1h/2h`)
- **Worklog & Metrics**: Time spent per day/project/tag, estimate accuracy
- **Notifications**: Show snackbar messages in SP's UI
- **Diagnostics**: Connection health check and directory debugging
- **Cross-Platform**: macOS (incl. App Store sandbox), Linux (incl. Snap), Windows
- **14 MCP Tools** with input validation and clear error messages

## Prerequisites

- [Super Productivity](https://super-productivity.com) >= 14.0.0
- Node.js >= 18
- An MCP-compatible client (Claude Desktop, Kiro, etc.)

## Installation

### 1. Install the SP Plugin

1. Download `plugin.zip` from the [latest release](https://github.com/b0x42/Super-Productivity-MCP/releases)
2. Open Super Productivity → Settings → Plugins
3. Click "Upload Plugin" and select `plugin.zip`
4. Restart Super Productivity

### 2. Configure Your MCP Client

Add to your MCP client config:

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

**Config file locations:**
- **Claude Desktop (macOS):** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Claude Desktop (Windows):** `%APPDATA%\Claude\claude_desktop_config.json`

### 3. Verify

Ask your AI assistant: *"Check the Super Productivity connection"*

## Available Tools

| Tool | Description |
|------|-------------|
| `create_task` | Create a task (supports SP short syntax) |
| `get_tasks` | List tasks with filters (project, tag, done, archived, search) |
| `update_task` | Update task fields (title, notes, done, time) |
| `complete_task` | Mark a task as complete |
| `create_project` | Create a new project |
| `get_projects` | List all projects |
| `update_project` | Update project properties |
| `create_tag` | Create a new tag |
| `get_tags` | List all tags |
| `update_tag` | Update tag properties |
| `get_worklog` | Time tracking summary for a date range |
| `show_notification` | Show a snackbar in SP's UI |
| `check_connection` | Verify SP is running and plugin is responding |
| `debug_directories` | Show resolved data directory paths |

## SP Short Syntax

Include these in task titles and SP will parse them automatically:

| Syntax | Example | Effect |
|--------|---------|--------|
| `#tag` | `Buy milk #errands` | Adds the "errands" tag |
| `+project` | `Fix bug +work` | Assigns to "work" project (prefix match, min 3 chars) |
| `@due` | `Report @friday` | Sets due date to Friday |
| `@due time` | `Call @tomorrow 3pm` | Sets due date and time |
| `30m` | `Quick fix 30m` | Sets 30-minute time estimate |
| `1h/2h` | `Research 1h/2h` | Sets 1h spent, 2h estimate |

## Troubleshooting

### Custom Data Directory

If SP is installed via Snap or Mac App Store, the plugin auto-detects the correct path. To override:

```json
{
  "mcpServers": {
    "super-productivity": {
      "command": "npx",
      "args": ["-y", "super-productivity-mcp"],
      "env": { "SP_MCP_DATA_DIR": "/custom/path" }
    }
  }
}
```

### Connection Issues

1. Ensure Super Productivity is running
2. Verify the MCP Bridge plugin is enabled (Settings → Plugins)
3. Ask: *"Show debug info for Super Productivity"* to check directory paths
4. Restart both SP and your MCP client

## Development

```bash
npm install
npm run build      # Build MCP server
npm test           # Run tests
npm run build:plugin  # Build plugin.zip
```

## Architecture

Two-component system communicating via file-based IPC:

1. **MCP Server** (TypeScript) — speaks MCP protocol over stdio, writes command JSON files
2. **SP Plugin** (JavaScript) — polls for commands, executes via PluginAPI, writes response files

## License

MIT
