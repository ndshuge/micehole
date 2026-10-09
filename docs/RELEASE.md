# Verification and release gates — v0.1.0 Preview

## Tested live in owner's Windows environment

- [x] Existing MiceHole: read/write/patch/search/run/validate.
- [x] Existing MiceHole: process start/wait/output/status.
- [x] Standalone Universal: MCP initialization, tools/list and nine tools.
- [x] Universal: file operations, command execution, Git, validation and process wait.
- [x] Universal: traversal, obvious credential paths and ambiguous patch rejected.

## Still required for a general public release

- [ ] Build and verify actual Windows installer binary.
- [ ] Verify install, upgrade, uninstall, fresh Windows VM, no system Node.
- [ ] Independent security review, malware scan and credential scanning.
- [ ] Decide an explicit project license. No permission to redistribute source has been selected yet.
- [ ] Verify bundled Node licenses and exact version.
- [ ] Publish downloadable installer, source and SHA256 on GitHub Releases.
- [ ] Demonstrate secure authenticated ChatGPT remote connection for an eligible unrelated user.
- [ ] Benchmark actual full tasks against Codex and Desktop Commander with matching hardware and models.

**Attribution note:** Earlier MiceHole versions use Desktop Commander as a backend for some generic computer capabilities. Do not claim that entire original stack was independently written. The Universal preview core is a new minimal Node implementation, not a performance-proven substitute for Codex.

Avoid public release until security and compatibility gates are satisfied.
