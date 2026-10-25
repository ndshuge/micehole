# Local vNext source sync — candidate, not a release

This branch stages selected developer-machine MiceHole Direct modules into the portable `direct/` tree without copying local credentials, browser profiles or workspace state. **Not a stable release. Not merged to main.**

## Scope
- Adds 15-tool MiceHole surface with dedicated Blender / Godot / ComfyUI adapters (unlike public v3.0.1, which has 12 tools).
- Updates browser CDP/policy and GUI safety modules, native file/search/git, response budget, project memory and runtime support.
- Supplements dependent source modules used by the new core.
- Keeps installation scripts and older v3.0.1 release unchanged.

## Evidence (2026-10-26)
- Node syntax checks of direct server modules: passed.
- Standalone `mouse-hole-core.mjs` import: passed; registers 15 tools.
- Standalone stdio initialize message: returned protocol `2025-06-18` and server version `0.2.1`.
- `git diff --check` passed after whitespace cleanup.
- Text scan of changed/new files for obvious API key patterns and workstation-specific paths: no API-token-shaped string detected; scan **does not prove secret-free source**.
- No full Windows packaged-install, remote mobile ChatGPT authentication, high-privilege authorization or GUI real-world acceptance run for **this candidate branch**. Do not advertise these as completed.

## Release blockers
1. Run tests from isolated source tree, and rebuild distribution/manifest. Existing v3.0.1 badge/docs/tool-count refer to **main release**, not this branch.
2. Portable default workspace and all supporting scripts require a second independent-machine test; specialized integrations may need installed dependencies and must fail safely if missing.
3. Reconcile changes to browser security and window focus against pre-existing production deployment/hash conflicts before deploying to any production machine.
4. Audit system-level command execution, user permission gates, browser profiles, credentials and network behavior before offering a new remote high-privilege installer.
5. Test the real ChatGPT mobile → authenticated tunnel → Windows read/test loop with a disposable project, then intentional denial tests and recovery.
6. Once accepted, update CHANGELOG, install docs, badges, release notes and installer checksum, then merge into main and tag a **new** release. Never replace v3.0.1 binaries in-place without QA.

## Developer checkout
```powershell
git fetch origin feature/local-vnext-sync-20261026
git switch feature/local-vnext-sync-20261026
node --check direct/mcp/remote/mouse-hole-server.mjs
```

Do not run the upgraded server as Administrator; test only in an isolated disposable directory. Do not attach personal browser profiles.
