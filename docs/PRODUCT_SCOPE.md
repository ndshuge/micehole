# MiceHole product contract — self-hosted personal ChatGPT remote coding

**Decision: 2026-10-10.** This project is a downloadable Windows app, **not** a publicly
listed ChatGPT plugin, marketplace product, shared cloud MCP service, or model API provider.

## One-sentence goal

Any eligible user can install MiceHole on **their own Windows PC**, attach **their own
OpenAI Secure MCP Tunnel**, add a **personal/private MCP plugin** in supported ChatGPT
clients, and remotely perform the same end-to-end code development workflow currently
used by the project's owner.

## The user's journey (release acceptance)

1. Download signed or checksum-verifiable MiceHole Setup.exe from GitHub Releases.
2. Install without administrator rights where possible; see a clear setup wizard.
3. Choose a specific authorized project workspace (not the entire system drive).
4. Use the bundled, verified official OpenAI tunnel-client to initialize a **personal**
   Tunnel ID and runtime key through hidden input. Never ask users to share credentials
   with the maintainer or put them in ChatGPT prompts.
5. In a supported ChatGPT account, create a *private* MCP plugin using the personal Tunnel.
   Clearly surface plan/workspace/browser/mobile limitations and give troubleshooting steps.
6. From ChatGPT, run a permissioned project task: inspect files → edit → run/test/build →
   read results → fix → report with evidence. No external MiceHole model API is required.
7. Keep the local link alive through disconnects; support a visible stop/restart and
   **opt-in** logon background operation. Do not silently enable remote access.
8. Revocation, uninstall, upgrade and rollback are documented and tested; no tasks,
   processes, logs or credentials linger unexpectedly.

## Feature parity requirement

Owner runtime capabilities are a **target to compare against**, not a promise that
the current downloadable 9-tool Universal Preview already includes them.
Full remote coding requires controlled shell execution, long-running process
start/wait/output/stop, Git and validation. More specialized local creativity tools
(Blender/Godot/ComfyUI, GUI/browser) may be later optional integrations rather than
mandatory dependencies for the first public release.

Current release-blocking reality: the downloadable personal Tunnel entry point exposes
**only five file/status tools**, deliberately blocking arbitrary shell/validation/process/Git
until a **separate Windows security principal/worker** protects the Tunnel credential.
Documentation, UI and release notes must not call this a complete Codex-like agent yet.

## No-goals

- No public ChatGPT plugin directory submission, review or listing.
- No shared hosted MCP backend that operates on all users' machines.
- No server-side model inference, API token resale or need for a MiceHole-specific AI API.
- No requirement to build a competing ChatGPT client/chat UI.
- No ownership of the user's personal Tunnel ID, private data or OpenAI platform account.
- No unsupported claim that every Free/Plus/mobile account has private write-MCP access.

## Roadmap, strictly prioritized

**P0 — full remote execution with safety**
  Broker/Worker privilege split, separate Windows identity, protected credential storage,
  authenticated local IPC, project ACL/approval, bounded process lifetime, fail-closed behavior;
  then safely restore run, validate, process and Git in the *remote* MCP tool list.

**P0 — third-party proof**
  Clean Windows install by a second person with their own Tunnel, own ChatGPT access,
  remote code change and test, credential revocation, uninstall and troubleshooting evidence.

**P1 — stable lifecycle**
  Test actual reboot/logon (not just a synthetic crash), sleep/wake, proxy/network change,
  offline recovery, controlled restart and no orphan processes.

**P1 — smooth onboarding**
  Wizard and status panel showing local runtime, Tunnel state, tool connection, logs/Doctor
  and explicit permissions, with clear handling of ineligible ChatGPT accounts.

**P2 — distribution maturity**
  Signed installer where feasible, updater/rollback, privacy-preserving diagnostics,
  Windows Defender/SmartScreen and dependency license validation, supported-account matrix,
  documented security reports, repeatable CI and invited user feedback.

## Release thresholds

- **Public limited v0.1.0 Beta:** source and Windows binary with five remote file/status tools; remote execution locked; account compatibility and independent third-party pairing not guaranteed.
- **Invitation Beta:** different user can independently complete a real personal-Tunnel
  remote code+test task, and high-severity access paths have been reviewed; list limitations.
- **Mature public self-hosted app:** multiple independent users, verified recovery and
  reinstall/update/rollback, reviewed security boundary, support and release provenance.

Passing ZIP smoke tests or a cloud Windows boot marker test is **not** sufficient for Beta.
A public GitHub release is distinct from a public ChatGPT plugin listing.
