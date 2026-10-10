# W2-C · Dedicated Windows Worker security experiment

**Status: CI-only dedicated Windows account proof PASSED on a disposable GitHub runner ([evidence](https://github.com/ndshuge/micehole/actions/runs/38043795746)); not integrated into the installer.**

## The actual product boundary

Each user installs MiceHole on their own Windows computer, configures their own
Secure MCP Tunnel and creates their own private ChatGPT MCP connection.
The Worker account is an internal implementation detail. No central service,
public plugin directory or MiceHole-issued model API is required.

## Why test a dedicated account?

The old test used Windows `LOCAL SERVICE` SID `S-1-5-19`. It proved that
the Broker and Worker **can** use different Windows tokens, but the SID is
shared by other services. That is not automatically suitable for running
untrusted project build scripts.

W2-C adds a separate fixture:
`.github/workflows/worker-dedicated-identity.yml`, calling
`scripts/tests/verify-dedicated-worker-ci.ps1` on a **disposable GitHub-hosted
Windows runner**, never on the owner's PC.

### Checks performed by this experiment

1. Refuse execution unless platform variables identify a GitHub-hosted
   Windows Actions runner; no local account creation on the owner machine.
2. Generate a random one-time password in memory; create a dedicated test
   local account; verify it is distinct from Broker and not in Administrators.
3. Deny the new identity read access to a **dummy** Broker credential folder
   while granting explicit project-workspace write rights.
4. Authenticate the Windows named-pipe peer using the actual impersonated
   client SID. Reject same-user imitation.
5. Under that dedicated SID, run only a **fixed test** `whoami /user`,
   using the existing suspended-creation Windows Job Object runner.
6. Launch the Worker using Windows CreateProcessWithLogonW under the generated
   account (not a password in a CLI argument), and test bounded stdout/stderr,
   status, exit codes, timeout and cancellation inside a Job.
7. Terminate the test Worker, delete the disposable account, verify it no
   longer exists, and remove temporary workspace and credentials.

**Separate pending test:** actual Task Scheduler startup/recovery under a
newly provisioned account. The first CI Task Scheduler experiment returned
last-result 267011 (task had never run). This account-identity experiment
therefore explicitly uses an independent Windows logon API instead, and does
not claim scheduled autostart compatibility.

**Security regression caught by CI:** creating a dummy Broker credential file
*before* setting restrictive directory permissions allowed the dedicated Worker
to read it because of the pre-existing file ACL. The fix applies the directory
ACL first, creates the key afterward, and explicitly protects the file DACL.
The final Windows test requires a **real access-denied result** for the worker
SID; simply inspecting an ACL is insufficient.

### Not proven / not in the installer

- No production install, user consent wizard, scheduled startup, or rollback/upgrade path.
- A standard local account is not a complete sandbox: Windows group rights,
  network and named-pipe access, alternate tokens and executable/ACL privilege
  escalation still need a dedicated threat-model audit.
- Broker authenticity to Worker, exclusive pipe instance prevention,
  one-time request nonces and replay-safe framing remain incomplete.
- The test authenticates an outgoing Worker-to-Broker pipe call; it is not a
  remotely accessible command router, and it uses only **dummy** keys.
- Strict per-session process tree limits and quotas for untrusted builds remain.
- Public EXE/ZIP still exposes only the five protected file/status MCP tools.
  **Remote shell/Git/process/validate remain locked.**

Evidence belongs in [DEVLOG](DEVLOG.md), [WORKER_ISOLATION](WORKER_ISOLATION.md),
[Issue #4](https://github.com/ndshuge/micehole/issues/4) and the GitHub
Action log. This test is intentionally **manual workflow_dispatch**, not a
routine push-triggered job creating accounts.
