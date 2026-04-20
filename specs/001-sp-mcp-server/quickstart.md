# Quickstart: Super Productivity MCP Server

## Prerequisites

- Super Productivity >= 14.0.0
- Node.js >= 18
- An MCP-compatible client (Claude Desktop, Kiro, etc.)

## 1. Install the SP Plugin

1. Download `plugin.zip` from the latest GitHub release.
2. Open Super Productivity → Settings → Plugins.
3. Click "Upload Plugin" and select `plugin.zip`.
4. Restart Super Productivity.

## 2. Configure Your MCP Client

Add to your MCP client configuration:

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

**Config file locations**:
- Claude Desktop (macOS): `~/Library/Application Support/Claude/claude_desktop_config.json`
- Claude Desktop (Windows): `%APPDATA%\Claude\claude_desktop_config.json`

## 3. Verify the Connection

Ask your AI assistant:

> "Check the Super Productivity connection"

Expected response: Connected, plugin version, protocol version, and data directory paths.

If you see "Super Productivity is not responding", ensure:
1. Super Productivity is running.
2. The MCP Bridge plugin is enabled in SP Settings → Plugins.
3. Restart both SP and your MCP client.

## 4. Try It Out

- "Create a task called Review quarterly budget"
- "Show me all my tasks"
- "Create a project called Work"
- "Mark the quarterly budget task as done"

## Troubleshooting

### Custom Data Directory

If SP is installed via Snap or Mac App Store, the plugin auto-detects the correct path. To override:

```json
{
  "mcpServers": {
    "super-productivity": {
      "command": "npx",
      "args": ["-y", "super-productivity-mcp"],
      "env": {
        "SP_MCP_DATA_DIR": "/custom/path/to/data"
      }
    }
  }
}
```

### Debug Directories

Ask your AI: "Show debug info for Super Productivity"

This returns the resolved data directory, command/response directories, and whether they exist.
