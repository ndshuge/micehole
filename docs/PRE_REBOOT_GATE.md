# MiceHole: pre-reboot acceptance gate (2026-10-10)

This gate is for **self-hosted personal Tunnel remote coding on Windows**.
It is deliberately **not** a general-public release sign-off.

## Safe execution boundary

During this gate:

- Never restart Windows, the owner's production MiceHole runtime, production Tunnel
  or OpenHanako task; do not install into the production app directory.
- Do not create Windows users, grant admin rights, change protected ACLs or open ports.
- No real OpenAI tokens are needed; all Tunnel and worker simulations are local
  and use fake credentials or short-lived test identities.
- The only live OS mutation is an **explicit per-user QA installer test** on an
  isolated directory. It first rejects any pre-existing public Universal install,
  then installs and uninstalls immediately. This does **not** exercise the user's
  production MiceHole instance.
- Logs and reports are placed under `qa-fixture/` (untracked/ignored).

## What the automated gate checks

| Gate | Mechanism | Requirement |
| --- | --- | --- |
| Local MCP behavior | `scripts/smoke-test.mjs` | nine local tools still work |
| File and path safety | `scripts/security-test.mjs` | deny escape, junctions, hardlinks, ADS, secrets |
| Remote least privilege | `scripts/remote-safe-test.mjs` via `verify-portable.ps1` | remote only five file/status tools; no shell |
| Tunnel initial setup | `verify-tunnel-onboarding.ps1` | fake Tunnel ID, official CLI, no real key |
| Watchdog recovery | `tests/verify-supervisor.ps1` | simulate crash, recover, kill owned test child |
| Install safety | `verify-installer-contract.ps1` | no silent autostart, uninstall hook present |
| Current-session EXE lifecycle | `tests/verify-installer-lifecycle.ps1` | isolated install, default shell off, uninstall cleanup |
| Publishing hygiene | `public-preflight.mjs` | no accidentally tracked secrets or unknown binaries |
| Live production safety | protected port/PID snapshot | existing broker/runtime listener PIDs unchanged |

Run from the Git checkout:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\tests\pre-reboot-gate.ps1 -ProtectedPorts 8791,8792
```

On a different user's computer, omit `-ProtectedPorts`, or supply the *actual known
production service ports* to assert they stayed untouched.

The gate writes machine-readable evidence to
`qa-fixture/pre-reboot-gate/report.json`. A successful result is
`PRE_REBOOT_GATE=PASS` **and** `PUBLIC_RELEASE_GATE=BLOCKED`.
If these appear together, it means non-reboot checks are complete — **not**
that we may publish the full remote shell product.

## Evidence from a clean outside Windows runner

The GitHub Actions `installer-lifecycle.yml` workflow additionally exercises an opt-in
Task Scheduler registration/removal with a fake key on its disposable hosted runner.
It never starts a real Tunnel, never reboots and always attempts cleanup.
It builds the EXE using
a signature-verified Inno compiler, tests a real fresh-user install/uninstall,
then confirms the product can no longer be found in the registry. Its result
must be reviewed separately: a clean hosted Windows Runner is not proof of
compatibility with every Windows account or every ChatGPT plan.

## Cloud OS reboot research

See [CLOUD_REBOOT.md](CLOUD_REBOOT.md). GitHub standard Windows Runner does not provide a guaranteed nested Windows guest; the optional existing Azure VM workflow performs a real OS reboot only after OIDC and dedicated QA VM tags are configured. Until then, no cloud reboot has been performed.

## Hard stop / gates *after* this point

1. **Windows identity separation** — run AI programs under a different SID,
   verify Worker receives Access Denied on the Broker's Tunnel credential.
   The present `MICEHOLE_REMOTE_SESSION` restriction must remain active
   until this is independently verified. See [WORKER_ISOLATION.md](WORKER_ISOLATION.md).
2. **Actual new user's OpenAI Tunnel + ChatGPT plugin** — separate account,
   tool discovery, permissions, mobile compatibility and real coding.
3. **Cold reboot / login persistence** — only after the dedicated Worker and
   watchdog plan is approved. Validate startup, sleep/wake, proxy change,
   stop/disable/uninstall and no orphan processes.
4. **Public release** — independent security review, clear README limitations,
   versioned installer and supported account matrix.

A reboot does **not** magically isolate a same-user DPAPI key.
Do not toggle full remote terminal execution merely because this pre-reboot
gate has passed. The repository and Release must remain Private/Draft until
the other blockers close.
