# Contributing and development traceability

MiceHole is a **self-hosted Windows app** using the user's own ChatGPT access,
Secure MCP Tunnel and private personal MCP plugin. Public plugin directory submission
is not planned.

## Where to follow development

- [Development journal](DEVLOG.md) — chronological decisions, fixes, validation and known limitations
- [GitHub Issues](https://github.com/ndshuge/micehole/issues) — specific remaining work and acceptance evidence
- [Milestones](https://github.com/ndshuge/micehole/milestones) — safety Worker, first external user, mature release
- [Git history](https://github.com/ndshuge/micehole/commits/main) — actual code changes
- [GitHub Actions](https://github.com/ndshuge/micehole/actions) — smoke/installer/Worker security/Windows QA evidence
- [Release gate](RELEASE.md) — what must pass before inviting users

## A lightweight engineering loop

1. Choose a relevant existing Issue for substantive work (create one only if missing).
2. Implement and test directly; Issues are **not** a separate command queue.
3. Commit focused changes with informative messages, preferably `area: summary`.
4. Link the Issue and CI run for meaningful safety/functionality changes.
5. Update [DEVLOG.md](DEVLOG.md) on architectural decisions, new acceptance
   milestones, important bug fixes and completed blockers.
6. Only close an Issue after its **acceptance evidence** actually exists.
7. Keep the repository **Private** and existing releases **Draft** until the maintainer
   explicitly authorizes public access.

## Proof and privacy

- Label each result as real Windows OS, disposable CI, fake Tunnel, offline config,
  or simulated worker. Do not call a prototype a deployed feature.
- Never upload live Tunnel keys/IDs, DPAPI key blobs, API tokens, private home paths,
  private source code, user account identifiers or unredacted environment logs.
- A public Windows installer must keep full remote execution **disabled** until
  distinct Worker SID, credential ACL, pipe identity, user approval and fail-closed
  behavior have passed review.
- Never run a cloud VM reboot or account/service mutation without appropriate
  authorization and target verification.

If you want to make a contribution, file an Issue or PR with a reproducible,
sanitized problem statement and test evidence; do not post security secrets publicly.
