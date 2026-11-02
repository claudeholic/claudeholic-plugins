# linkedin-mcp

Unofficial Claude Code plugin that adds the LinkedIn MCP server to Claude Code with one install.

> **Unofficial wrapper.** The MCP server itself is
> [mcp-server-linkedin](https://github.com/stickerdaniel/linkedin-mcp-server) by **Daniel Sticker**,
> licensed under the **Apache License 2.0**. This plugin only declares that server (pinned version,
> started via `uvx`); it bundles none of its code. This plugin is not affiliated with, authorized or
> endorsed by the server's author, LinkedIn Corporation or Microsoft. "LinkedIn" is a trademark of
> LinkedIn Corporation, used here only to identify the service.

## What you get

The MCP server `linkedin`, with tools available under the `mcp__plugin_linkedin-mcp_linkedin__*`
prefix: read person and company profiles, your own profile, feed and posts; search people,
companies, jobs and posts; job details and saved jobs; read the messaging inbox and conversations;
send messages and connection requests (write actions — use them deliberately). See the
[upstream README](https://github.com/stickerdaniel/linkedin-mcp-server#readme) for the full tool list.

Pinned server version: **mcp-server-linkedin 4.23.3** (tested). Upstream recommends `@latest`;
this plugin pins a version on purpose and is bumped after testing.

## Requirements

- **[uv](https://docs.astral.sh/uv/getting-started/installation/)** (`uvx` must be on `PATH`) and
  **Python >= 3.12.4, < 3.15** (uv can download a matching Python itself if none is installed). The first start downloads the Python dependencies; the plugin sets
  `UV_HTTP_TIMEOUT=300` for slow connections.
- **A LinkedIn account.** The server reads LinkedIn through your own logged-in browser session,
  driven by a Patchright-managed Chromium (downloaded on first use to
  `~/.linkedin-mcp/patchright-browsers/`). The session is stored in `~/.linkedin-mcp/profile/`.
  On the first tool call that needs it, the server tries to import a live LinkedIn session from a
  locally signed-in Chromium-based browser (Chrome, Chromium, Brave, Edge, …); if none is usable,
  it opens a login window where you sign in yourself. You can also prepare the session up front:

  ```
  uvx mcp-server-linkedin@4.23.3 --login                 # sign in in a browser window
  uvx mcp-server-linkedin@4.23.3 --import-from-browser   # reuse a session from your browser
  ```

  LinkedIn may ask for a CAPTCHA or a confirmation in its mobile app during login.

## Install

```
/plugin marketplace add claudeholic/claudeholic-plugins
/plugin install linkedin-mcp@claudeholic-plugins
```

Restart Claude Code after installing.

**Already have this server configured manually?** If your `~/.claude.json` (or a project
`.mcp.json`) has its own entry running `mcp-server-linkedin`, remove that entry after installing
the plugin (e.g. `claude mcp remove <name>`) — otherwise the same tools are registered twice.

## Risk warning

Automated access to LinkedIn may violate the
[LinkedIn User Agreement](https://www.linkedin.com/legal/user-agreement). LinkedIn actively
detects unusual activity and may log you out, require verification, restrict or ban your
account. Use it at your own risk: keep volume low, avoid bulk searches and rapid sequences of
calls, and stop when LinkedIn shows a login page, CAPTCHA or warning.

## License

- The plugin wrapper files (`.claude-plugin/plugin.json`, `README.md`) are licensed under the
  Apache License 2.0, copyright Michal Dzwoniarski.
- `LICENSE` and `NOTICE` are the unmodified files from the upstream project
  [stickerdaniel/linkedin-mcp-server](https://github.com/stickerdaniel/linkedin-mcp-server)
  (Copyright 2025 Daniel Sticker, Apache License 2.0). The server, downloaded by `uvx` from PyPI,
  is distributed under those terms.
