# Connect MiceHole v0.1.0 Beta

## Local stdio MCP (tested)

Use a client that supports locally launched stdio MCP servers. Point it to:

```text
%LOCALAPPDATA%\Programs\MiceHole\micehole.cmd
```

For clients that require an absolute path, expand `%LOCALAPPDATA%` for your
own Windows user before saving the configuration:

```json
{
  "mcpServers": {
    "micehole": {
      "command": "C:\\Users\\YOUR_USER\\AppData\\Local\\Programs\\MiceHole\\micehole.cmd"
    }
  }
}
```

It uses your own compatible MCP/AI client. Local commands are disabled by default
and must be explicitly enabled; local execution is **not a sandbox**.

## User-owned personal Tunnel for ChatGPT (experimental)

The distribution includes the official `tunnel-client`, personal initialization,
hidden key input, foreground launch and health checks. Follow
[SELF-HOSTED](SELF-HOSTED.md) and
[ChatGPT Quickstart](CHATGPT-QUICKSTART.md) for the steps.

Remote tools exposed by this beta: **status, read, write, patch, search**.
Remote `run`, `Git`, `validate` and `process` remain disabled independently
of local settings.

**Compatibility:** OpenAI Platform Tunnel and custom private ChatGPT MCP/plugin
entitlements depend on your account/workspace/client. An EXE download alone does
not add a ChatGPT plugin or turn an unsupported phone client into a supported
MCP client. There is no shared public MiceHole server and no public plugin
directory listing. Never forward a raw Windows MCP port to the Internet.

The author's existing private MiceHole deployment is a separate, more capable
setup and should not be confused with the downloadable Universal beta.
