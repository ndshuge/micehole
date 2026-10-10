# MiceHole Universal v0.1.0 Beta — public early-access preview

**Windows x64 · unsigned per-user installer / portable ZIP · independent community project.**

This is the **first limited public download**, not the finished end-to-end
remote software-development agent.

## Included

- A standalone Windows MCP engine with bundled Node.js runtime.
- Basic workspace status, read, write, patch and search.
- Experimental user-owned Secure MCP Tunnel configuration using the verified
  official tunnel-client and user-supplied personal Platform credentials.
- Protected remote launcher advertises **only five file/status tools**. It
  blocks remote shell, Git, validation and process operations even if local
  shell has been enabled.
- Optional per-user MiceHole Control / Doctor with explicitly opt-in background
  task. No unattended autostart on install.
- Local stdio MCP mode supports extra shell/Git/process/validate with a
  **separate explicit opt-in**. Local commands are not a secure sandbox.

## Verified

Local file-operation/security regression tests, packaged remote tool
restrictions, portable ZIP with bundled Node/tunnel-client, simulated
Supervisor crash/recovery, and isolated real install/uninstall on Windows.
W0–W2-C worker security experiments are CI-only and **not shipped/enabled**.

## Important limitations

- A clean unrelated person's real ChatGPT account / Tunnel pairing has **not**
  been verified; some accounts/workspaces/clients cannot add custom write-capable
  private MCP plugins.
- Remote code execution, automated run/test/fix, Git and long process sessions
  are **not available** in this version.
- Installer is **unsigned**. No promise that SmartScreen will accept it.
- DPAPI protects secrets at rest but not from untrusted code executed as the
  same Windows user; therefore remote command execution remains locked.
- Cold reboot, sleep/wake, multi-network recovery, real upgrade/rollback and
  independent external security assessment are outstanding.

Start with [INSTALL](INSTALL.md), [SELF-HOSTED](SELF-HOSTED.md) and
[SECURITY](SECURITY.md). Do not share Tunnel keys or API credentials in issues.
