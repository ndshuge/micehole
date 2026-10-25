# MiceHole vNext 0.2.1 RC1 — draft release candidate

**STATUS: DRAFT / NOT APPROVED FOR PUBLIC RELEASE.**

This candidate packages a local Windows Direct MCP server for disposable test projects. **Do not enable remote high-privilege access on a personal or production Windows machine based on this draft.** Not affiliated with OpenAI; does not provide additional model quotas.

## Changes compared with v3.0.1
- 15 registered MCP tools (previous portable V3 public version: 12)
- Added dedicated Blender, Godot, ComfyUI tool interfaces
- Updated browser profile/security policy and GUI foreground/game protection modules
- Updated filesystem, Git, search, project-state, response-budget and supporting runtime implementation
- Setup, friend Doctor and portable smoke tests updated for the 15-tool candidate

## Verified on the developer machine
- Syntax and module import checks
- MCP initialize and tools/list in a separate directory
- Disposable-directory status, file-write and project memory tests
- Extracted ZIP first-run setup and Friend Doctor (15 tools, local_ready=true, remote_verified=false)
- Remote entry guard: unapproved connection denied; approved test advertises 15 tools
- Portable ZIP built, extracted, and executed; 15 tools discovered
- ZIP SHA256 generated and rechecked; 69 packaged paths; no sensitive-path filenames matched by pattern scan
- Git diff validation and basic token-like text scanning

## Blocking work before a public release
- **NOT VERIFIED:** independent Windows account and device install, hosted ChatGPT mobile → private tunnel → Windows tool calls, safe reconnect/revocation/rollback
- **NOT VERIFIED:** independent credential isolation; processes under the same Windows user may access sensitive material. Workspace path checks are not a Windows command sandbox.
- **NOT VERIFIED:** full GUI / browser production deployment and privacy boundaries after prior manifest conflicts, including no-focus/gameplay behavior across software
- **NOT VERIFIED:** full Blender/Godot/ComfyUI integration test with dependencies installed, end-to-end handling of failure cases
- Public documentation and automated release gates still require version-specific updates before merge
- Only a developer preview. Do not tag this candidate as stable.

## SHA256
See the attached `MiceHole-Direct-vNext-0.2.1-RC-SHA256SUMS.txt`. Verify the ZIP before inspecting it.

## Download / installation note
The archive is for source review and isolated local stdio experiments only. Use the stable v3.0.1 release for the existing documented experience. Do not expose any unauthenticated TCP shell or run elevated.

## Repeatable developer RC gate
Run powershell -NoProfile -File scripts/vnext-rc-gate.ps1 from the repository to re-run local checks and rebuild the candidate. This checks local semantics only; the returned verified=true is NOT a remote-security release approval.
