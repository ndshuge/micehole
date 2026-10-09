# Connecting MiceHole: local MCP and ChatGPT

## Local stdio MCP — available

Use a compatible local MCP client configured to start:

    C:\Users\YOUR_USER\AppData\Local\Programs\MiceHole\micehole.cmd

Typical MCP client configuration (check your client's syntax):

    {
      "mcpServers": {
        "micehole": {
          "command": "C:\\Users\\YOUR_USER\\AppData\\Local\\Programs\\MiceHole\\micehole.cmd"
        }
      }
    }

This uses your existing client/model. MiceHole does not sell or supply model tokens.

## Remote ChatGPT — demonstrated in owner's existing deployment, not yet generally distributable

The intended architecture is ChatGPT -> authenticated and encrypted remote MCP channel -> Windows MiceHole -> allowlisted local workspace. The owner currently has a separate live MiceHole connection in ChatGPT that can issue remote Windows tool calls, but the Universal Preview package is a different distribution target and does not include this onboarding.

This preview does **not** package an authenticated cloud relay, OAuth login or account-level ChatGPT app onboarding. Never forward the local executor directly to the public internet.

As documented by OpenAI in October 2026, full custom MCP write support is rolling out to Business/Enterprise/Edu workspaces, and custom app support on mobile is restricted. Do not promise compatibility with all Free/Plus users.

For practical ChatGPT prompts and app selection, read [CHATGPT-QUICKSTART.md](CHATGPT-QUICKSTART.md).

Sources:
- https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt
- https://help.openai.com/en/articles/20001256-plugins-in-chatgpt
