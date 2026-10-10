# MiceHole public release acceptance gates (2026-10-10)

**Product:** Each user brings their own ChatGPT allowance, their own OpenAI Secure MCP Tunnel, and their own Windows computer. MiceHole runs authorized coding work on that PC. No separate MiceHole model API is required.

**Status:** PRIVATE / DRAFT only. Passing CI does not authorize public publication.

## Completed and reproducible

- [x] MIT source license selected for the standalone Universal preview (upstream packages retain their licenses).
- [x] Windows MCP handshake, nine tool schemas, text read/write/patch/search, Git, run, validate, process wait.
- [x] Automated negative tests for default-disabled shell, escaping workspace, credential-looking paths and Windows junctions.
- [x] Portable ZIP unpack-and-run test using bundled Node, including ensuring mock control-plane key variables are removed from MCP command shells.
- [x] Script syntax test and official tunnel-client init profile generation tested with a fake tunnel ID in an isolated local directory.
- [x] Actual owner production runtime, Tunnel poll, Supervisor and Doctor observed healthy without changing production configuration.
- [x] Private GitHub repository, bilingual README, draft installer/ZIP and Windows GitHub Actions workflow.

## Blocking before public release

- [ ] **Security:** resolve or explicitly redesign the same-user DPAPI key boundary for untrusted AI command execution. Same-user shell can access files beyond the workspace; it is not sandboxed. External review required.
- [ ] **Installation:** clean Windows user/VM Setup.exe install, upgrade, uninstall, no global Node dependency, no unexpected services/tasks, user settings preserved.
- [ ] **Remote pairing:** complete private-Tunnel runtime with a real separate test account. Validate tunnel association with the correct Platform organization and ChatGPT workspace, discovery, writable MCP tools and revocation.
- [ ] **Supported accounts:** document exactly which ChatGPT plans and web/mobile versions can create and call write-capable private MCP plugins. Do not equate an author's granted connection with universal eligibility.
- [ ] **Reliability:** package a reviewed user-level watchdog and measure disconnect/reconnect, computer reboot/logon, sleep/wake, proxy changes; no orphan processes.
- [ ] **Permission model:** explicit workspace consent, safe-default shell off, visible warnings for privileged shell and external network calls; clearer approval UX.
- [ ] **Supply chain:** verify official tunnel-client version and Apache 2.0 notices if bundled; Node license/version match; Inno Setup edition and permitted use; checksum/provenance; antivirus/SmartScreen behavior.
- [ ] **Release hygiene:** privacy-preserving log report, public vulnerability reporting, signed/not signed warning, real screenshots, final no-secret audit.

## Release model

- **Private preview now:** existing author installation + CI; not publicly usable.
- **Self-hosted public beta (desired):** downloadable installer with personal Tunnel setup and reliable lifecycle, supported account matrix, verified new-user demo, documented security boundaries.
- **Directory plugin later:** an independently hosted, authenticated public HTTPS MCP frontend would be needed for public plugin catalog submission. Secure MCP Tunnel itself is for self-hosted private connections.

## Test commands

From repository root in Windows PowerShell:

1. node scripts/smoke-test.mjs
2. node scripts/security-test.mjs
3. powershell -NoProfile -File scripts/check-remote-syntax.ps1
4. powershell -NoProfile -File scripts/build-release.ps1 -ZipOnly
5. powershell -NoProfile -File scripts/verify-portable.ps1
6. node scripts/public-preflight.mjs

Tests use disposable fixtures; builds are separate from production MiceHole/Tunnel.

## Project provenance

The Universal Preview implementation is a minimal standalone MCP engine with MIT-licensed source. Its nine-tool behavior is not equivalent to the author's original, more capable MiceHole runtime. Some earlier/original runtime operations used Desktop Commander as a backend. Product messaging must not hide this fact or falsely claim to distribute the production remote stack.
