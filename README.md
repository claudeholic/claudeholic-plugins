# Claudeholic Plugins

A personal collection of stable plugins that work with [Claude Code](https://code.claude.com/docs). Linux only.

## Installation

```
/plugin marketplace add claudeholic/claudeholic-plugins
```

Then browse and install plugins:

```
/plugin
```

## Available plugins

- **[chrome-shared](plugins/chrome-shared/)** — shared Chrome automation for Claude Code. Multi-session (one browser, many sessions), lazy launch, multiplexed engine, numbered tabs, no automation markers (no CAPTCHA triggers), lower RAM usage. Linux only.
- **[linkedin-mcp](plugins/linkedin-mcp/)** — unofficial wrapper for the [LinkedIn MCP server](https://github.com/stickerdaniel/linkedin-mcp-server) by Daniel Sticker (Apache-2.0), pinned and started via `uvx`. Profiles, companies, jobs, posts and messages through your own LinkedIn session. Automation may violate LinkedIn's terms — see the plugin README.

## License

Each plugin has its own license — see the plugin directory for details.
