# Public v0.1.0 Beta — publication audit

**Date:** 2026-10-10. **Scope:** early file-operation preview only. This is not an independent security certification.

## History and privacy

- Before making the repository public, reviewed **424 Git objects**, including history and other reachable branches.
- Eight test-only fake credential assignments (test sentinels), three generic `C:\Users\YOUR_USER` documentation examples, and five Node third-party-license author emails were detected and reviewed. No actual personal credential was identified in these findings.
- No matched GitHub PAT/OpenAI key literal, PEM private key, owner home directory, private workspace path, machine identifier or private network address in the implemented historical checks.
- Commit-author email addresses were checked to use GitHub noreply identities.
- Checked 10 existing GitHub Issue comments for key patterns, private home paths and machine identifiers: no hits.
- Automated secret detection is **not exhaustive** and the project has **not** received an external security audit.

## Packaging and permissions

- Build uses an explicit whitelist under `scripts/build-release.ps1`; experimental Worker sources, bridge configuration and concurrent transfer prototypes are excluded.
- Windows x64 user-level setup and portable ZIP contain Node.js and official tunnel-client with license/NOTICE material.
- Remote personal MCP advertises **only five file/status tools**. Local commands are independently opt-in and not sandboxed.
- Installer does not silently register a background task or public listener.
- Binary is **not code-signed**; users can verify SHA256SUMS and keep Microsoft Defender enabled.

## Limits

Real independent-user ChatGPT/Tunnel pairing, unsigned installer reputation, reboot/sleep recovery, upgrade/rollback, and full-remote-command Worker isolation are pending. Public early Beta is not the complete Codex-like product.

[Evidence and open gates](RELEASE.md) · [History](DEVLOG.md) · [Security](SECURITY.md).
