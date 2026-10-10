# MiceHole security policy / 安全边界

**Status: release candidate preparation; not independently audited.**

MiceHole is a local command executor, **not a secure sandbox**. It gives an authorized AI/MCP client access to a Windows workspace and, after explicit opt-in, the ability to run arbitrary commands with the privileges of its Windows account. This is a powerful trust decision.

## Default protections (automatically tested)

- The initial Windows config has \`executionEnabled=false\`. Read/write operations are still possible only within the configured workspace.
- File read/write/patch/search reject traversal outside the workspace, typical credential paths (such as .env, .ssh), and known symlink/junction traversal.
- Tunnel profile and runtime key live outside the repository. The runtime key is entered in a hidden prompt and stored encrypted using Windows DPAPI CurrentUser.
- The packaged MCP launcher clears \`CONTROL_PLANE_API_KEY\`, \`MOUSE_HOLE_CONTROL_PLANE_API_KEY\` and \`OPENAI_API_KEY\` from the environment before launching Node and any child shell.
- Tunnel health listens on loopback. The package does not open inbound public ports, install unattended autorun or request administrator privileges by default.

## Important limitations and remaining launch blockers

1. **Same-user credential isolation:** Windows DPAPI CurrentUser is encryption at rest, not isolation from other processes of the same Windows account. Once shell execution is enabled, AI-triggered code can potentially read or decrypt a runtime key stored under the same account. Clearing the environment is not a sufficient mitigation. A production-grade remote coding edition requires a reviewed separate Windows security principal / credential broker, or an alternative design that avoids a persistently retrievable runtime key in the worker's security context.
2. **Command scope:** file-operation workspace checks **do not** confine arbitrary PowerShell, Node, build scripts or git hooks. Those commands can access files outside the workspace and make network requests. Only enable shell execution for projects and models you trust, preferably inside a disposable restricted Windows user or VM.
3. **Process lifetime:** terminating a parent process might not terminate all descendants. Managed processes do not survive MCP server restarts.
4. **Untrusted repository code:** npm, pip, cargo, git hooks, test scripts, and project-specific tools can execute code; review before running.
5. **New-user support:** ChatGPT and OpenAI Tunnel access are account/workspace dependent. A local installer cannot grant missing Platform permissions, model quota or mobile support.

## Before any public download announcement

- Security audit, automated regression tests and Windows clean-user install/uninstall.
- Validate installer signatures/provenance, checksum manifests and dependency licenses.
- Verify a **different human account** can complete the full Tunnel → ChatGPT plugin → Windows coding operation.
- Document how to revoke Tunnel keys, stop background operation and remove local authorization.
- Set up GitHub private vulnerability reporting when repository visibility changes.

## Responsible disclosure

Until public release, report suspected vulnerabilities privately to the repository maintainer. **Never** open a public issue containing API keys, remote profiles, user data or exploit code targeting someone else's system.

MiceHole is independent of OpenAI and is not official Codex. Its source is MIT-licensed; bundled Node.js remains under its own license. The OpenAI tunnel-client is distributed separately under its Apache-2.0 license.
