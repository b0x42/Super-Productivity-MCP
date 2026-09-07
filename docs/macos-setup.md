# macOS setup and operations

This runbook describes a pinned, source-based macOS deployment of the Super
Productivity MCP bridge. It covers the two components that must be running
together:

1. the MCP server used by Codex or another MCP client; and
2. the Super Productivity plugin that receives commands through file-based
   IPC.

The server and plugin must use the same MCP data directory. If they use
different directories, the server can be running while Super Productivity
appears unresponsive.

## Ownership of files and state

| Item | Location | Versioned? |
| --- | --- | --- |
| MCP server and plugin source | this repository (`src/` and `plugin/`) | Yes |
| Generated server and plugin bundle | `dist/` | Generated; do not edit by hand |
| Codex registration | `~/.codex/config.toml` | No; keep an example in `config/` |
| Super Productivity application data and task database | `~/Library/Application Support/superProductivity/` | No |
| MCP IPC directory | `~/Library/Application Support/super-productivity-mcp/` | No |
| App Store sandbox IPC fallback | `~/Library/Containers/com.superproductivity.app/Data/Library/Application Support/super-productivity-mcp/` | No |

Do not commit task databases, IPC command/response files, local logs, tokens,
or a machine-specific Codex configuration. The repository should document how
to recreate the setup, not copy the live task state.

## Current local deployment

The working deployment uses:

- the checked-out `dist/index.js` rather than an `npx` download;
- the rebuilt `dist/plugin.zip` uploaded to Super Productivity;
- an explicit `SP_MCP_DATA_DIR` pointing at the native macOS Application
  Support directory; and
- Codex write approval for mutating MCP tools.

The corresponding configuration shape is shown in
[`config/codex-mcp.example.toml`](../config/codex-mcp.example.toml). The
actual local configuration must use absolute paths for the current checkout.

## Build and install from source

From the repository root:

```bash
npm ci
npm run typecheck
npm test
npm run lint
npm run build
```

`npm run build` compiles the MCP server and creates `dist/plugin.zip`.

Then install the plugin:

1. Open Super Productivity.
2. Go to **Settings → Plugins → Upload Plugin**.
3. Select `dist/plugin.zip`.
4. Enable the plugin.
5. Accept the one-time Node execution permission.
6. Restart Super Productivity if the plugin does not respond immediately.

The server and plugin should be kept on the same version. After changing
either side, rebuild and reinstall the plugin before testing again.

## Codex configuration

The live file is `~/.codex/config.toml`. A source-based entry has this shape:

```toml
[mcp_servers.super_productivity]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/Super-Productivity-MCP/dist/index.js"]
default_tools_approval_mode = "writes"
startup_timeout_sec = 120

[mcp_servers.super_productivity.env]
SP_MCP_DATA_DIR = "/absolute/path/to/Library/Application Support/super-productivity-mcp"
```

A local deployment may use Homebrew Node and a repository checkout selected by
the user. Keep those machine-specific values in `~/.codex/config.toml`; use the
redacted template in this repository when configuring another machine. Do not
commit personal home-directory paths or local task-system details to this
public repository.

Check registration with:

```bash
codex mcp list
```

## Verification checklist

Run these checks in order:

1. Confirm that Super Productivity is open and the MCP plugin is enabled.
2. Ask Codex to run `check_connection`.
3. If the connection fails, ask Codex for `debug_directories`.
4. Confirm that the server and plugin report the same `SP_MCP_DATA_DIR`.
5. Read the newest IPC response file:

   ```bash
   ls -lt ~/Library/Application\ Support/super-productivity-mcp/plugin_responses/ | head -5
   ```

6. Perform a harmless read-only task query before testing a write.
7. Test a write only after reviewing the proposed change and approving it.

## Diagnosing the macOS path problem

The plugin checks both of these locations:

```text
~/Library/Application Support/super-productivity-mcp
~/Library/Containers/com.superproductivity.app/Data/Library/Application Support/super-productivity-mcp
```

To see which location is active:

```bash
ls -lt ~/Library/Application\ Support/super-productivity-mcp/plugin_responses/ 2>/dev/null | head -5
ls -lt ~/Library/Containers/com.superproductivity.app/Data/Library/Application\ Support/super-productivity-mcp/plugin_responses/ 2>/dev/null | head -5
```

If the plugin writes to the sandbox location, set `SP_MCP_DATA_DIR` to that
absolute path in the MCP client configuration. Do not guess based only on the
path displayed by the application; verify which directory receives recent
response files.

## If Super Productivity starts and then stops responding

Use this recovery sequence:

1. Toggle the MCP plugin off and on in **Settings → Plugins**.
2. Confirm that the Node execution permission was accepted.
3. Confirm that the installed plugin and the running server have the same
   version.
4. Run `check_connection` and `debug_directories` again.
5. Confirm that `SP_MCP_DATA_DIR` is explicit and writable.
6. Restart both Super Productivity and the Codex session.

The general troubleshooting guide contains the version-specific SP startup
notes: [`docs/troubleshooting.md`](troubleshooting.md).

## Security and maintenance

The plugin uses privileged Node execution and file-based IPC. Treat plugin
updates as executable code: inspect the diff, rebuild from the intended commit,
and upload the resulting bundle. Keep Codex's default MCP write mode at
`"writes"` so reads can be used for inspection while task mutations remain an
approval checkpoint.

The current macOS path fix is maintained in the fork and proposed upstream in
[Super-Productivity-MCP PR #111](https://github.com/b0x42/Super-Productivity-MCP/pull/111).
Do not replace the pinned local deployment with an upstream or `npx` version
until the upstream change has been reviewed and the exact tested commit is
known.
