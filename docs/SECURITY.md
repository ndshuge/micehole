# Security model

MiceHole is a command executor, NOT a sandbox.

- By default executionEnabled is false. The user must explicitly approve enabling shells and build scripts.
- File read/write/search/patch tools are restricted to the configured workspace. Obvious credential-like folders and symlink traversal are refused.
- Enabling shell execution can run ANY code under your actual Windows user account, including reading files outside the workspace and using the network. The file restriction is not a shell boundary.
- Never publish a remote unauthenticated endpoint. A remote public edition requires identity, authorization, TLS, auditing, and a consent UX.
- Prefer a disposable Windows user or virtual machine for unfamiliar repositories.
- Don't publish API keys, cookie stores, .env files, profiles or private data in sample projects.
- Processes are managed per MCP server instance and may be lost across restart. Killing a process may not terminate its complete descendant tree.
- No automatic administrator elevation, startup persistence or public network exposure is installed.

Before public release: independent code audit, fresh-machine install/uninstall, dependency licenses, malware scan and red-team tests.

After the repository is public, set up a GitHub private security advisory workflow for vulnerability reports.
