# Streamable HTTP

By default the MCP server speaks stdio: your MCP client spawns `super-productivity-mcp` for each session. The plugin can also run **one long-lived server** that several clients — including ones on another machine or in a container — connect to over Streamable HTTP. It is **off by default**.

- [Enabling it](#enabling-it)
- [Settings](#settings)
- [Managing the server](#managing-the-server)
- [A busy port](#a-busy-port)
- [The bearer token](#the-bearer-token)
- [Security](#security)
- [Running the server yourself](#running-the-server-yourself)
- [How it works](#how-it-works)
- [Platform notes](#platform-notes)

See also [troubleshooting](troubleshooting.md#streamable-http-not-listening).

## Enabling it

In Super Productivity open **Settings → Plugins → SP MCP Server → ⚙** and tick **Enable Streamable HTTP server**. The plugin starts the server straight away (and stops it when you untick). Point a client at `http://<address>:<port>/mcp`:

```json
{ "mcpServers": { "super-productivity": { "type": "http", "url": "http://127.0.0.1:8765/mcp" } } }
```

For Claude Code:

```bash
claude mcp add --transport http super-productivity http://127.0.0.1:8765/mcp
```

The HTTP server exposes the same tools and resources as stdio. It is stateless: only `POST /mcp` is served (`GET` and `DELETE` return 405), and request bodies over 1 MiB are rejected. stdio keeps working exactly as before, and the two can run side by side.

## Settings

| Setting | Default | Notes |
|---|---|---|
| Enable Streamable HTTP server | off | |
| Bind address | `127.0.0.1` | `127.0.0.1` accepts connections from this machine only. `0.0.0.0` accepts them from your whole network — see [Security](#security). |
| Port | `8765` | 1–65535 |
| Start and stop the server from Super Productivity | on | Untick if you run the server yourself — see [below](#running-the-server-yourself). |
| Require bearer token | off | **Best practice — recommended**, and strongly so for any bind address other than `127.0.0.1`. See [the bearer token](#the-bearer-token). |
| Allowed hosts | empty | Accepted values of the request's `Host` header, separated by commas or spaces, e.g. `console.example.org, 10.0.0.5:8765`. A name without a port matches any port. |
| Allowed origins | empty | Browser pages that may call the server, as full origins separated by commas or spaces, e.g. `http://console.example.org` (no path). |

Every setting takes effect within a few seconds without restarting anything: the running server follows the settings.

An invalid address, port, allowed host or allowed origin keeps the server **off** and shows an error toast. It never falls back to a default.

## Managing the server

The plugin's page in Super Productivity — the **SP MCP Server** entry in the sidebar, the same page that lists tool calls — has an **MCP HTTP server** panel at the top:

- a coloured dot and a sentence saying what the server is doing (listening on…, retrying, or why it stopped);
- **Restart** and **Stop** while it runs, **Start** when it doesn't;
- when a token is required, the token itself, masked, with **Show**, **Copy** and **New token**.

Buttons show progress ("Restarting…") until the plugin acknowledges them, normally within a couple of seconds. If the plugin stops reporting, the panel greys out and says its information may be out of date.

How the plugin looks after the process:

- It ships the server inside itself and launches it with Super Productivity's own Node runtime, so there is nothing else to install and no `PATH` to get right. Output goes to `http_server.log` in the data directory.
- If Super Productivity quits or crashes, the server notices and exits within seconds; it never lingers holding your port.
- If the server keeps dying, the plugin relaunches it up to 3 times in 2 minutes, then stops and tells you where the log is.
- **Stop** is sticky: the server stays stopped until you press **Start** or untick and re-tick the option.
- A server that someone else started is left alone. The panel labels it as running outside Super Productivity and offers no controls, because the plugin cannot restart a process it did not start.

## A busy port

If the port is taken, the server tries **3 times, 5 seconds apart**. If all three attempts fail it reports the error (in the panel and as one error toast) and **stops trying**, rather than knocking in the background.

Free the port or choose another, then press **Restart** in the panel. Changing any setting, or unticking and re-ticking the option, also starts a fresh round of attempts.

## The bearer token

A token is off by default, but it is best practice — switch on **Require bearer token**, especially when binding beyond `127.0.0.1`. The plugin shows a warning if you bind to the network without one.

The settings form is synced between your devices and included in backups, so it is no place for a credential. Instead, the first time the server starts with the option on, the plugin generates a random 256-bit token and stores it in Super Productivity's **local-only secret storage**: never synced, exported or backed up, and separate on each device. A dialog shows it once; afterwards it is in the panel's token row. **Show** reveals it, **Copy** copies it, and **New token** replaces it — it asks twice, because replacing the token locks out every client that has the old one. A new token takes effect within a few seconds.

Clients send it as `Authorization: Bearer <token>`. For Claude Code, add `--header "Authorization: Bearer <token>"` to the `claude mcp add` command above.

To hand the token to the server the plugin writes it to `http_config.json` in the data directory, created owner-only (mode `0600`). If you run the server yourself you can set `SP_MCP_HTTP_TOKEN` in its environment instead; that takes precedence.

## Security

The endpoint can read and modify all of your tasks.

- **`Host` header.** On a loopback bind, requests whose `Host` is not `localhost`, `127.0.0.1` or `[::1]` (or listed in *Allowed hosts*) are refused with 403, which blocks DNS-rebinding. On other binds, setting *Allowed hosts* turns the same check on; without it the `Host` header is not validated and the server logs a note.
- **`Origin` header.** Browsers always send `Origin`; other clients do not.
  - On a **loopback bind**, with *Allowed origins* empty, `Origin` is not checked, and pages served from `localhost`, `127.x` or `[::1]` (any port) are always accepted with CORS. Once you list any origin, every other `Origin` is refused.
  - On **any other bind**, a request carrying an `Origin` that is not in *Allowed origins* is refused with 403, so by default no web page can drive a network-exposed server.
  - For accepted origins the server answers CORS preflights and adds `Access-Control-Allow-Origin`; the token, if required, still applies.
  - An origin that is not allowed never receives a CORS grant, so even when its request is let through the page cannot read the response.
- **Protocol versions.** The server speaks MCP Streamable HTTP (revision 2026-07-28) through the MCP SDK, which supports protocol versions up to `2025-11-25`. Clients speaking a newer revision (e.g. `2026-07-28`) are served using `2025-11-25`; a message is logged when this happens. Clients should send `MCP-Protocol-Version: 2025-11-25` (or omit the header — it is treated as `2025-11-25`).
- **No sessions.** Every request is independent (`POST /mcp`); there are no `Mcp-Session-Id` sessions and no `initialize` handshake is required.
- **Notifications** (a request with no `id`) are answered with `202 Accepted` and no body.
- **Token.** Binding beyond loopback without one logs a warning and shows a warning toast.
- **No TLS.** For anything beyond a trusted network put a reverse proxy in front, or use an SSH tunnel or VPN. Behind a proxy, add the public name to *Allowed hosts*.

## Running the server yourself

The default flow needs no command line. `--http` remains for setups where Super Productivity does not launch the server — a container, another machine, a service manager. Untick *Start and stop the server from Super Productivity* and run:

```bash
super-productivity-mcp --http        # or: npx -y super-productivity-mcp --http
```

It follows the same plugin settings through the shared data directory. Set `SP_MCP_DATA_DIR` on both sides if they would otherwise resolve different directories (for example Super Productivity on the host and the server in a container or WSL). With the option off — or never touched — it idles and binds nothing.

Super Productivity cannot restart a server it did not start. To retry after a busy port, restart the process, or untick and re-tick the option.

## How it works

The settings, the plugin, the server and the pane communicate through small files in the data directory — the same channel the rest of the bridge uses:

- the plugin publishes the validated settings as `http_config.json`; the server re-reads it every couple of seconds;
- the server reports its state, errors and a heartbeat in `http_status.json`;
- the plugin publishes a plain-text description of the server as `http_panel.json`; the pane draws it;
- the pane sends a request by writing `http_control.json`; the plugin acts on it and acknowledges.

Formats, field-by-field validation, launch arguments and every timing constant are in [`specs/009-streamable-http/contracts/files.md`](../specs/009-streamable-http/contracts/files.md); the requirements are in [`specs/009-streamable-http/spec.md`](../specs/009-streamable-http/spec.md).

The server the plugin launches is the same code as `dist/index.js`, bundled into a single file with its dependencies and embedded in `plugin.js` at build time (`npm run build` produces it). A plugin built from a source checkout without that step has no embedded server: the settings are still published, and you run `super-productivity-mcp --http` yourself.

## Platform notes

- **Windows** has no graceful `SIGTERM`, so stopping the server is a forced termination and the server cannot write a final "stopped" status. The plugin knows it stopped the process and reports it as stopped straight away; a server that dies on its own is noticed through its heartbeat within 20 seconds.
- **Running in a container or on another machine** needs the data directory shared with Super Productivity (`SP_MCP_DATA_DIR`), and clocks that roughly agree, since liveness is judged from timestamps in `http_status.json`.
- **Clipboard.** Super Productivity's pane may not be allowed to use the clipboard. If **Copy** is blocked, the panel shows the token so you can select it by hand.
