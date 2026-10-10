# W2-C · Dedicated Windows Worker security experiment

**Status: CI-only implementation; real disposable Windows account test not yet verified.**

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
6. Within a Job, verify bounded stdout/stderr, status, exit codes, timeout
   and cancellation through the previously tested fixture.
7. Stop/unregister the disposable Task Scheduler entry, delete the account,
   check neither remains, delete temporary workspace and release password.

### Not proven / not in the installer

- No production install, user consent wizard or rollback/upgrade path.
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
