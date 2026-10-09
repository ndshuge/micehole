# MiceHole Universal v0.1.0 — Private preview

The first independently testable Universal edition provides nine basic MCP tools and does **not** depend on Godot, Blender, ComfyUI or an extra model API.

## Validated
- Windows Node.js stdio MCP server initialize and tools/list
- Workspace file read/write/patch/search
- Shell command, Git status and validation execution
- Persistent process start/wait/output/status
- Rejections for some suspicious file paths and ambiguous edits

## Not yet qualified for public distribution
- Remote ChatGPT full write support for arbitrary consumers
- Independent security audit / Windows Sandbox testing
- Fresh-account installer and uninstaller test
- Fair comparisons against Codex
- Third-party software license and distribution review

Read SECURITY.md carefully. Shell execution is disabled by default. No remote tunnel is provided by this release.
