# MiceHole public release acceptance gates (2026-10-10)

**Product:** Each user brings their own ChatGPT allowance, their own OpenAI Secure MCP Tunnel, and their own Windows computer. MiceHole runs authorized coding work on that PC. No separate MiceHole model API is required.

**Status:** PRIVATE / DRAFT only. Passing CI does not authorize public publication.

## Completed and reproducible

- [x] MIT source license selected for the standalone Universal preview (upstream packages retain their licenses).
- [x] Windows MCP handshake, nine tool schemas, text read/write/patch/search, Git, run, validate, process wait.
- [x] Automated negative tests for default-disabled shell, escaping workspace, credential-looking paths, Windows junctions, NTFS hardlinks, alternate streams and special device names.
- [x] Protected personal-Tunnel entry point advertises only five file/status tools and refuses run/validate/process/git even when local execution is enabled; test verified on packaged Windows runtime.
- [x] Portable ZIP unpack-and-run test using bundled Node, including ensuring mock control-plane key variables are removed from MCP command shells.
- [x] Script syntax test and official tunnel-client init profile generation tested with a fake tunnel ID in an isolated local directory.
- [x] Official tunnel-client v0.0.15 Windows x64 archive pinned to SHA256 3B53133A1E24D43F63088D843860CB1701A4C3ED6390DE2E19F69089E43BDDC1, with its LICENSE and NOTICE included in the distribution.
- [x] Actual owner production runtime, Tunnel poll, Supervisor and Doctor observed healthy without changing production configuration.
- [x] Independent public user-level Supervisor script simulated with a fake Tunnel: detect crash, restart owned process, recover /readyz, release process on exit. UI provides explicit opt-in controls; task registration itself is only dry-run tested.
- [x] Inno Setup uninstall hook removes only the personal task. A **real silent install → safe bootstrap → silent uninstall** completed successfully in a unique QA directory on the owner's current Windows session without reboot; clean hosted Windows Runner verification is tracked separately.
- [x] Private GitHub repository, bilingual README, draft installer/ZIP and Windows GitHub Actions workflow.

## Blocking before public release

- [ ] **Security:** personal Tunnel is now a limited file-editing preview with remote shell permanently locked. For the full Codex-like remote build/run workflow, resolve same-user DPAPI key access by separating execution from Tunnel credentials with a distinct Windows security principal or reviewed broker; independent audit required.
- [ ] **Installation:** no-reboot real install/uninstall and bundled Node smoke test passed in an isolated current-user directory; clean independent Windows Runner, upgrade over prior version and another-user profile remain to verify.
- [ ] **Remote pairing:** complete private-Tunnel runtime with a real separate test account. Validate tunnel association with the correct Platform organization and ChatGPT workspace, discovery, writable MCP tools and revocation.
- [ ] **Supported accounts:** document exactly which ChatGPT plans and web/mobile versions can create and call write-capable private MCP plugins. Do not equate an author's granted connection with universal eligibility.
- [ ] **Reliability:** User-level watchdog is now packaged and simulated crash/recovery passed. Still verify actual scheduled-task registration, uninstall cleanup, real network failures, reboot/logon and sleep/wake on a clean Windows account; no orphan processes.
- [ ] **Permission model:** explicit workspace consent, safe-default shell off, visible warnings for privileged shell and external network calls; clearer approval UX.
- [ ] **Supply chain:** official tunnel-client archive and notices are now pinned and packaged. Still validate Node license/version match; Inno Setup permitted commercial use if applicable; executable checksum/provenance; antivirus/SmartScreen behavior.
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
6. powershell -NoProfile -File scripts/verify-tunnel-onboarding.ps1
7. powershell -NoProfile -File scripts/tests/verify-supervisor.ps1
8. powershell -NoProfile -File scripts/verify-installer-contract.ps1
9. powershell -NoProfile -File scripts/tests/verify-installer-lifecycle.ps1 -PlanOnly
10. powershell -NoProfile -File scripts/tests/verify-installer-lifecycle.ps1 (only on an isolated Windows account with no Universal installation)
11. node scripts/public-preflight.mjs

Tests use disposable fixtures; builds are separate from production MiceHole/Tunnel.

## Project provenance

The Universal Preview implementation is a minimal standalone MCP engine with MIT-licensed source. Its nine-tool behavior is not equivalent to the author's original, more capable MiceHole runtime. Some earlier/original runtime operations used Desktop Commander as a backend. Product messaging must not hide this fact or falsely claim to distribute the production remote stack.
