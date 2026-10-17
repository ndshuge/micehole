# Changelog

## [Unreleased — main] — 2026-10-17 · Network diagnostics

- **Optional Windows network doctor:** `direct/scripts/network-doctor.ps1` checks an explicitly supplied localhost HTTP proxy, generic HTTPS and the unauthenticated OpenAI API response. Optional local Tunnel port check. No credential inspection, DNS modification, proxy selection or background process.
- **Better failure classification:** distinguishes proxy port closed, proxy/upstream errors, OpenAI-specific HTTP reachability and network probe passed. Subscription quota is explicitly unknown; users must check their provider.
- **Clash/Mihomo guidance:** reuse an existing `fallback` group for node failover if desired; no bundled node lists, subscriptions or automatic failover changes are shipped.
- **Friend-facing docs:** [overview](docs/RELEASE_NOTES_NETWORK_2026-10-17.md) and [setup/troubleshooting](docs/NETWORK-RELIABILITY.zh-CN.md).
- **Verification:** PowerShell parser passed, local closed-port detection and explicit proxy 204/401 live probes passed on the developer machine; existing Direct smoke tests passed. Friend cross-account E2E, planned restart/recovery, and released ZIP integration are not yet verified.

**Release status:** main source/documentation update only; released v3.0.0 ZIP does not include this feature.
## [Unreleased — main] — 2026-10-16

Source update (no new installer or binary release).

- **Process-state isolation:** `mouse_hole_process.start/wait/status/output/stop` no longer persists transient execution changes as `WAITING_PROCESS`, `RUNNING`, `wait_for_process` or `continue_plan` in project STATUS/TODO/LOG. Only an explicit project memory operation writes a durable milestone.
- **Progressive project context:** `construction://continue?project=...` exposes links to applicable workspace/project `AGENTS.md`, optional MD policy and canonical `STATUS.md` without loading unrelated documents. ChatGPT stays the only planner; MiceHole remains hands and eyes.
- **Idempotent checkpoints:** repeating an unchanged milestone leaves project memory files untouched; obvious credential patterns in managed project memory fields are rejected.
- **Portable guidance:** initialization instructions no longer embed a developer-specific disk path; use the configured workspace root. Small projects are not required to adopt the optional four-file managed memory format.
- **Verification:** added `scripts/test-md-habit.mjs` (5 portable checks), preserved the 12-tool Direct smoke test, and documented what was verified only in a separate internal development environment. See [MD habits](docs/MD-HABITS.md).

**Not changed:** MCP tool count, high-privilege authorization boundary, installed V3 release artifacts, remote tunnel credentials, or need for an actual Windows process backend for long-running commands.

## [0.1.0 Beta] — 2026-10-10

**First limited public Windows x64 preview.** This is not the finished remote development agent.

### Included
- Windows per-user Setup.exe and portable ZIP; bundled Node.js and checksum-verified official tunnel-client with licenses.
- Workspace status/read/write/patch/search for local MCP and experimental personal Secure MCP Tunnel.
- Exactly **five remote file/status tools**; remote shell, Git, run/validate/process are locked.
- Additional local MCP commands only after separate user opt-in; not a sandbox.
- Doctor, MiceHole Control, optional opt-in recovery; installer never auto-enables remote access.
- Windows portable, security, simulated watchdog, installer lifecycle and CI tests.

### Not yet verified
- Real independent user's ChatGPT private MCP plugin + Tunnel pairing.
- Remote command execution, signed binaries, true reboot/sleep recovery, upgrade/rollback or external security review.
- W0–W2-C separate-user Worker experiments are CI-only and not included in this release.

[Install](docs/INSTALL.md) · [Security](docs/SECURITY.md) · [Development log](docs/DEVLOG.md).
