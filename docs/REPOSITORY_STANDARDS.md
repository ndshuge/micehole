# Repository engineering standards

## Source and local artifacts

- Commit reproducible source, tests, build recipes, and documentation.
- Do not commit downloaded build tools, generated distributions, or local QA configurations.
- Never commit real Tunnel credentials, tokens, private keys, local profiles, or personal paths. A .gitignore does not sanitize tracked files or Git history.
- Use sanitized *.example configuration files.

## Acceptance criteria

1. Preserve pre-existing uncommitted work.
2. Add regression tests for behavior changes.
3. Run repository-hygiene, public-preflight, smoke-test, and security-test scripts.
4. Check Windows-specific changes in Windows CI. Local Node tests are not proof of Windows runtime security.
5. Update CHANGELOG and release gates for externally visible changes.
6. Distinguish **implemented**, **tested locally**, **tested in CI**, **tested with an independent user**, and **released** capabilities.

## Publishing and security claims

- Check all reachable Git history for leaked secrets and verify published SHA256 sums.
- Do not call a build stable without evidence for install, upgrade, uninstall, actual remote pairing, and the relevant security model.
- MiceHole is independent of OpenAI and Codex. ChatGPT and Tunnel access depend on provider plans, quotas, and permissions, so do not promise unlimited free Codex use.
- Remote arbitrary command execution requires separately verified security controls. Documentation changes cannot make an unsafe capability safe.

See [SECURITY](SECURITY.md), [CONTRIBUTING](CONTRIBUTING.md), and [RELEASE](RELEASE.md).
