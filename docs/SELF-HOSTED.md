# MiceHole Self-Hosted: Your own Tunnel + Your own PC

**Goal:** ChatGPT allowance + personal Secure MCP Tunnel + Windows = Codex-like remote coding without separately buying a MiceHole model API.

**Status:** The personal Tunnel setup script has generated a correct offline profile with the official tunnel-client in a disposable test directory. The public installer is not yet a complete verified remote/phone solution; owner production deployment remains separate and more capable.

## Prerequisites

- Windows x64 with MiceHole Universal installed.
- Your OpenAI Platform Tunnel ID, Tunnel runtime API key, and required Platform Tunnels Read + Use permission; Tunnel creation needs Manage.
- ChatGPT account/workspace with custom MCP write access on a supported client.
- Windows installer now **bundles verified official tunnel-client v0.0.15**, its license and NOTICE; no separate download is required. Advanced users can supply an alternate official client manually.

## Quick setup

1. Install MiceHole Universal. Run MiceHole Doctor first, using a disposable project.
2. At https://platform.openai.com/settings/organization/tunnels create your personal Tunnel. At https://platform.openai.com/settings/organization/api-keys create a runtime key, not an admin key.
3. In PowerShell in your MiceHole installed directory, run:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\remote-setup.ps1 -TunnelId "tunnel_YOUR_ID"
~~~

The script invokes the bundled verified official tunnel-client to generate a personal stdio MCP profile. An alternate binary can be specified with -TunnelClient. It prompts for your runtime key without echoing it. The credential is protected using Windows-user DPAPI, never placed in the project or profile YAML.

To replace a runtime key, run:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\remote-save-key.ps1
~~~

4. In the same directory, run:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\remote-doctor.ps1 -ConfigurationOnly
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\remote-doctor.ps1 -Deep -ConfigurationOnly
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\remote-run.ps1
# In another PowerShell window, once tunnel-client is running:
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\remote-doctor.ps1
~~~

Keep remote-run.ps1 open while using the Tunnel on your first test. **Stop the foreground Tunnel before enabling background recovery** to avoid competing for its loopback health port. The background mode is installed only after explicit confirmation in MiceHole Control. A doctor check is only **connected/ready** when the Tunnel health endpoint responds; use -ConfigurationOnly before first start. The Windows control panel can inspect state **and offers explicit opt-in buttons to enable, stop or remove the per-user background watchdog**. Before enabling it, close the manual foreground Tunnel instance:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\remote-control.ps1
~~~

For advanced users, the optional background task can also be managed from PowerShell:

~~~powershell
# Always close a manually started foreground Tunnel first.
powershell -NoProfile -File .\scripts\remote-autostart.ps1 -Action Status
powershell -NoProfile -File .\scripts\remote-autostart.ps1 -Action Install
powershell -NoProfile -File .\scripts\remote-autostart.ps1 -Action Start
# To stop or uninstall the task without deleting your credentials:
powershell -NoProfile -File .\scripts\remote-autostart.ps1 -Action Stop
powershell -NoProfile -File .\scripts\remote-autostart.ps1 -Action Remove
~~~

5. In **ChatGPT web** with compatible access, open Plugins → + → Add custom MCP server → Tunnel → choose your tunnel ID → review warnings → create and install the plugin. Type @ in a supported conversation, choose the plugin, and test mouse_hole_status.

## Test task

> @MiceHole In my disposable test project, write a small static webpage, run suitable tests and report actual output. Do not read other directories or change Windows settings.

## Current limits and safety

- The public preview has 9 basic tools and a local stdio MCP engine. It does not include your owner's full custom Runtime + watchdog stack.
- Command execution is off by default and, if enabled, is **not a sandbox**. The AI may execute shell commands as your Windows account.
- The launched MiceHole command clears the Tunnel API key environment variables before invoking the coding engine. This is **not sufficient credential isolation**. A process running as the same Windows user may still decrypt that user's DPAPI credential file. Do not put real secrets on an untrusted system.
- **Opt-in background mode is now packaged as a preview:** the Control panel can install a per-user scheduled recovery task. The supervisor has passed an offline simulated crash/recovery test; real logon/sleep/proxy-change testing and credential isolation still remain before public release. Start with the foreground command for initial setup.
- Your ChatGPT subscription and usage limits still apply. Custom MCP/plugin access and phone compatibility differ by account and client. Private tunnels are not the public plugin directory submission path.
- Do not share your runtime key, expose local MCP ports publicly or publish your profile directory.

## Official documentation

- https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- https://developers.openai.com/api/docs/guides/custom-mcp-server
- https://developers.openai.com/plugins/deploy/connect-chatgpt
- https://github.com/openai/tunnel-client
