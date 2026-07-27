# Troubleshooting

## Plugin Not Responding After Install

If the connection check fails after a fresh install or reboot, toggle the plugin off and back on in **Settings → Plugins**. This is a [known SP issue](https://github.com/super-productivity/super-productivity/issues/7326) where the `nodeExecution` permission isn't ready when the plugin first loads.

## Connection Issues (General)

1. Ensure Super Productivity is running
2. Verify the MCP Bridge plugin is enabled (Settings → Plugins)
3. Ask your AI assistant: *"Show debug info for Super Productivity"* — this shows the directory paths both sides are using
4. If paths differ between server and plugin, set `SP_MCP_DATA_DIR` (see below)
5. Restart both SP and your MCP client

## Mac App Store — Sandbox Path Mismatch

When SP is installed from the Mac App Store, it runs in a sandbox. The MCP server and the SP plugin resolve the shared data directory independently and can disagree on the path:

- Sandbox: `~/Library/Containers/com.superproductivity.app/Data/Library/Application Support/super-productivity-mcp`
- Non-sandbox: `~/.local/share/super-productivity-mcp`

**Diagnose** — check which directory the plugin is actually writing to:

```bash
ls -lt ~/.local/share/super-productivity-mcp/plugin_responses/ | head -5
ls -lt ~/Library/Containers/com.superproductivity.app/Data/Library/Application\ Support/super-productivity-mcp/plugin_responses/ | head -5
```

Whichever has recent files is where the plugin writes. Set `SP_MCP_DATA_DIR` to that path.

## Windows Store — Sandboxed Installs Block IPC

If either Super Productivity or your MCP client (e.g. Claude Desktop) is installed from the **Microsoft Store**, it runs in an app sandbox. The sandbox isolates the filesystem even when directory paths reported by both sides look identical — the plugin and server end up writing to different physical locations, so commands never reach the plugin.

**Symptom:** debug info shows matching paths, everything looks configured correctly, but responses never arrive.

**Fix:** install both Super Productivity and your MCP client as native (non-Store) apps — download installers directly from the vendor instead of the Microsoft Store. Uninstall the Store versions first to avoid leftover sandboxed data directories.

## Setting a Custom Data Directory

Override the auto-detected path via `SP_MCP_DATA_DIR` in your MCP client config:

```json
{
  "mcpServers": {
    "super-productivity": {
      "command": "npx",
      "args": ["-y", "super-productivity-mcp"],
      "env": {
        "SP_MCP_DATA_DIR": "/path/to/super-productivity-mcp"
      }
    }
  }
}
```

Common values:

| Scenario | Path |
|----------|------|
| macOS non-sandbox | `~/.local/share/super-productivity-mcp` |
| macOS App Store sandbox | `~/Library/Containers/com.superproductivity.app/Data/Library/Application Support/super-productivity-mcp` |
| Linux (standard) | `~/.local/share/super-productivity-mcp` |
| Linux (Snap) | `~/snap/superproductivity/current/.local/share/super-productivity-mcp` |
| Linux (sandboxed/Flatpak) | `/tmp/super-productivity-mcp` |
| Windows | `%APPDATA%\super-productivity-mcp` |

> **Note:** On Linux, if `~/.local/share` is not writable (e.g. Fedora with restrictive permissions or Flatpak sandboxing), the plugin and server will automatically fall back to `/tmp/super-productivity-mcp`. This directory may be cleared on reboot but works without any configuration.

## `ReferenceError: process is not defined`

This occurs on plugin versions ≤ 1.1.1 when SP's plugin sandbox doesn't expose the Node.js `process` global. Update to version 1.2.0+ which guards against this. If you installed the plugin manually, re-download `plugin.zip` from the [latest release](https://github.com/b0x42/Super-Productivity-MCP/releases/latest).

## Version Mismatch

The MCP server and SP plugin must be on the same version. After updating one, always update the other. To check which versions are running, ask your AI assistant: *"Check the Super Productivity connection"*
