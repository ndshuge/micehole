## What and why

Describe the user-visible or technical problem and its related GitHub Issue.

Closes #

## What changed

Describe significant behavior changes, especially MCP tool access, Windows permissions,
Tunnel credential handling, process lifecycle and installer side effects.

## Evidence

- [ ] Ran relevant local tests (exact command and output, or why not)
- [ ] Linked the GitHub Actions run / disposable Windows VM evidence
- [ ] Updated docs/DEVLOG.md for substantial changes or a release milestone
- [ ] Marked any **simulation vs real** test boundary explicitly
- [ ] Recorded remaining risks and the next acceptance gate
- [ ] Confirmed this does not alter the owner's live MiceHole or Tunnel unexpectedly
- [ ] Checked the diff for secrets, machine-specific paths and user data

## Release / safety declaration

- Does this enable arbitrary command execution over personal Tunnel? If yes, link the
  independent Worker/SID/ACL audit and explicit approval evidence.
- Does it create an OS user, task, service, listener or network connection? Explain.
- **Do not** mark Private/Draft release public as part of an unrelated PR.

Direct-to-main fixes remain permitted when justified; the same evidence standard applies.
