# MiceHole development journal / 开发日志

**Product:** Windows EXE + user's own Secure MCP Tunnel + user's own private ChatGPT MCP plugin.
No public plugin directory or shared hosted agent is planned.

This journal documents **what actually changed, why, how it was tested, and what is still blocked**.
For historical source details use commit history; for current acceptance status use
[RELEASE.md](RELEASE.md); for open work use [GitHub Issues](https://github.com/ndshuge/micehole/issues).

## Current checkpoints (2026-10-10)

| Track | Evidence | Status |
|---|---|---|
| Self-hosted product scope | [35c9372](https://github.com/ndshuge/micehole/commit/35c9372) | Defined |
| Windows installer/ZIP, bundled official Tunnel client | [Release acceptance](RELEASE.md) | CI and isolated install/uninstall passed |
| Restricted personal Tunnel MCP | [07a49d2](https://github.com/ndshuge/micehole/commit/07a49d2) | **Only 5 remote file/status tools**, no shell |
| Background supervisor | [b01b73a](https://github.com/ndshuge/micehole/commit/b01b73a) | Simulated crash/restart passed |
| No-reboot safety gate | [Cloud and local gate](PRE_REBOOT_GATE.md) | 11 local checks passed |
| Independent Windows SID and dummy secret ACL | [GitHub Actions W1](https://github.com/ndshuge/micehole/actions/runs/38021364814) | Disposable CI proof passed |
| Full production isolated Worker | [W2 IPC issue](https://github.com/ndshuge/micehole/issues/2) | **Not implemented** |
| Independent user's own ChatGPT Tunnel pairing | [Beta issue](https://github.com/ndshuge/micehole/issues/5) | **Not verified** |
| Real product reboot and reconnection | [Stability issue](https://github.com/ndshuge/micehole/issues/7) | **Not verified** |

These statuses intentionally distinguish tested prototypes from a mature public release.
This repository is currently **Private** and its downloadable preview Release remains **Draft**.

## Timeline

### 2026-10-10 — W2-B2 bounded stdout/stderr and process session

**Problem:** Earlier Worker experiments could launch or cancel fixed test
processes but could not query live stdout/stderr, truncation, independent
process state and timeouts as a reusable session unit.

**Implementation:** Added test-only `BoundedWorkerSession` running strictly
inside a Windows Job. It streams stdout/stderr concurrently into fixed-size
byte tail buffers, provides start/status/output/wait/stop APIs, records nonzero
exit and truncation metadata, and automatically terminates the root after
a bounded runtime. No remote requests or real credentials are involved.
The CI-only broker/worker test also runs this session under a real LocalService
SID, after kernel-backed pipe client identity verification.

**Evidence:** [1792539](https://github.com/ndshuge/micehole/commit/1792539) ·
[GitHub separate-SID Worker CI PASS](https://github.com/ndshuge/micehole/actions/runs/38026856062) ·
[Issue #3](https://github.com/ndshuge/micehole/issues/3).

**Limits:** A session inherits a pre-existing outer Job Object; Stop itself
kills the root only, not arbitrary descendants. Per-session Job isolation,
output consumption cursors, persistent request framing, supported executable
policy, install/uninstall provisioning and actual runtime credential isolation
remain for production. Remote full shell remains locked.

### 2026-10-10 — W2-B Windows Job Object process lifecycle

**Problem:** Terminating only the parent PowerShell process could leave an AI-invoked
program's child processes running. The earlier fixed Worker test verified identity,
but did not prove process tree cleanup.

**Implementation:** Added a test-only Windows Job Object runner. It starts a fixed
executable **suspended**, assigns it to a Job with kill-on-close, then resumes it.
Validated exit codes, bounded waits, explicit timeout cancellation and an actual
nested child that outlived its parent but was killed when the Job was disposed.
Integrated the same runner into the disposable LocalService Worker after real
kernel-backed IPC identity verification; no new Windows account or reboot.

**Evidence:** [97636b3](https://github.com/ndshuge/micehole/commit/97636b3)
· [Windows worker CI PASS](https://github.com/ndshuge/micehole/actions/runs/38024653744)
· [Issue #3](https://github.com/ndshuge/micehole/issues/3).

**Limits:** Process results are tested through fixture workspace files, **not**
production streaming output. LocalService is a shared service identity; this is not
the finished per-app Windows Worker. No arbitrary ChatGPT-issued shell/Git/process
tools have been exposed, and the installer does not ship this new test component.

### 2026-10-10 — W2-A kernel-authenticated IPC integration

**Problem:** Fake-token IPC and a standalone Windows SID test did not yet prove that
Broker could authenticate a real **other-SID** Worker over a restrictive pipe.

**Implementation:** Added test-only `WindowsPipeAttestor`: explicit Windows named-pipe
ACL with just Broker and expected Worker SIDs; kernel-provided connecting client's SID;
same-user connection rejected. A disposable GitHub-hosted LocalService client performs
only a fixed workspace marker action after approval and verifies the dummy Broker
credential is inaccessible. No public-release binaries include this prototype.

**Evidence:** [Issue #2](https://github.com/ndshuge/micehole/issues/2) ·
[First positive restricted-pipe run](https://github.com/ndshuge/micehole/actions/runs/38023282919) ·
[Fixed child-process run](https://github.com/ndshuge/micehole/actions/runs/38023712838) ·
[346bbef](https://github.com/ndshuge/micehole/commit/346bbef) ·
[73827c0](https://github.com/ndshuge/micehole/commit/73827c0).

**Debugging:** The first extra child-command test failed because Windows PowerShell
`Start-Process -PassThru` did not reliably expose an exit code. Replaced it with
`System.Diagnostics.Process.Start` and a bounded six-second wait. GitHub Actions
then proved that a fixed `whoami /user` child runs under LocalService after kernel
peer-SID approval. It is a **test fixture**, not a general command runner.

**Limit:** LocalService is a shared identity. This does not implement dedicated
Worker provisioning, mutual channel authentication, IPC replay protections, job-object
process containment or production remote execution. The 5-tool Tunnel safety lock stays on.



### 2026-10-10 — GitHub engineering history and milestones

**Decision:** Keep building directly with ChatGPT/MiceHole; GitHub records the decision, code,
real testing and open risk without becoming a separate task queue. Established three
milestones ([M1](https://github.com/ndshuge/micehole/milestone/1),
[M2](https://github.com/ndshuge/micehole/milestone/2),
[M3](https://github.com/ndshuge/micehole/milestone/3)) and
[seven acceptance-focused Issues](https://github.com/ndshuge/micehole/issues).
Added repeatable Issue sync, contribution/checklist guidance and this journal.

**Limit:** This is documentation and tracking, not additional Worker security implementation.

### 2026-10-10 — Isolated Worker research and W1 proof

**Problem:** A Tunnel key encrypted for the signed-in Windows user is not isolated
from arbitrary AI-invoked code that runs as the *same* user.

**Implementation:** Added a deliberately non-executing Broker/Worker named-pipe fixture
and negative tests: fake peer auth, forged identity claims, message limits, sanitized
mock environment, and rejection of all execute/Git/process/validate requests.
Then verified a kernel-supplied Windows pipe client SID, and tested a genuinely
distinct LocalService SID inside disposable GitHub-hosted Windows, using a
**dummy** Broker credential and a separately writable project workspace.

**Evidence:**
[3ee6c02](https://github.com/ndshuge/micehole/commit/3ee6c02) ·
[f0c34c5](https://github.com/ndshuge/micehole/commit/f0c34c5) ·
[W1 real SID test](https://github.com/ndshuge/micehole/actions/runs/38021364814).

**Limit:** Production Windows Worker service, restricted pipe ACL, actual credential
access denial, secure tool unlock and process-tree cleanup are **not done**.
Remote shell remains locked. Follow [Worker isolation](WORKER_ISOLATION.md).

### 2026-10-10 — Product direction locked to user-owned private Tunnel

**Decision:** Users download MiceHole on their own Windows PCs, connect their own
official Secure MCP Tunnel and create a personal private MCP plugin inside eligible
ChatGPT accounts. A publicly listed ChatGPT plugin and shared hosted MCP gateway
are **explicit non-goals**.

**Evidence:**
[35c9372](https://github.com/ndshuge/micehole/commit/35c9372) ·
[Product contract](PRODUCT_SCOPE.md).

### 2026-10-10 — Cloud reboot investigation without changing owner's Windows

**Problem:** GitHub's hosted Windows Runner is ephemeral; restarting the runner
does not reliably prove that the same VM recovered. Hyper-V commands alone do not
prove a nested Windows guest is usable.

**Implementation:** Read-only nested-capability probe, plus a manually gated
GitHub workflow for an **existing tagged Azure Windows QA VM** that could perform
a true OS reboot with external evidence. Default execution is plan-only.

**Evidence:** [7fce5ec](https://github.com/ndshuge/micehole/commit/7fce5ec) ·
[3ccdd74](https://github.com/ndshuge/micehole/commit/3ccdd74) ·
[capability probe](https://github.com/ndshuge/micehole/actions/runs/38019982153).

**Limit:** No dedicated Azure test VM was connected and **no real cloud reboot**
occurred. See [Cloud reboot notes](CLOUD_REBOOT.md).

### 2026-10-10 — No-reboot release gate, Windows lifecycle and fault recovery

**Implementation:** Added an isolated real EXE install/first-run/uninstall test,
clean Windows CI environment verification, user-opt-in scheduled watchdog management,
and automated crash→restart→healthy tests using a fake Tunnel. Confirmed the owner's
production Tunnel/Runtime listener PIDs remained unchanged during local tests.

**Evidence:** [aeb1c2e](https://github.com/ndshuge/micehole/commit/aeb1c2e) ·
[62f1c1c](https://github.com/ndshuge/micehole/commit/62f1c1c) ·
[da28ec2](https://github.com/ndshuge/micehole/commit/da28ec2) ·
[clean Windows installer CI](https://github.com/ndshuge/micehole/actions/runs/38018827930).

**Limit:** Cross-reboot logon recovery, sleep/wake, proxy changes and a genuine
second person's account remain unverified.

### 2026-10-10 — Fail-closed remote mode and Windows path defense

**Problem:** A same-user shell could read the per-user Tunnel credential; merely
clearing API-key environment variables is not a sandbox.

**Implementation:** Separate protected personal-Tunnel entry point that advertises
only status/read/write/patch/search. Command execution stays local until the
security identity boundary is verified. Added path checks for traversal, junctions,
hardlinks, ADS, reserved device names and searches. Tests run on packaged ZIP.

**Evidence:** [07a49d2](https://github.com/ndshuge/micehole/commit/07a49d2) ·
[ec93eed](https://github.com/ndshuge/micehole/commit/ec93eed) ·
[security guide](SECURITY.md).

### 2026-10-10 — Standalone packaging and reproducible CI

**Implementation:** Created private standalone Universal engine, local MCP tool
tests, bundled official Tunnel client with pinned checksum/licenses, per-user
Inno Setup installer, portable ZIP, secure-key setup helpers, Doctor and status UI.
GitHub Actions checks installation and basic behavior. There is no standalone
public release authorization yet.

**Evidence:** [f9f378b](https://github.com/ndshuge/micehole/commit/f9f378b) ·
[04f1e90](https://github.com/ndshuge/micehole/commit/04f1e90) ·
[Smoke workflows](https://github.com/ndshuge/micehole/actions).

## Development evidence protocol

Every substantial engineering change should be discoverable in **four layers**:

1. **Why:** Link a GitHub Issue describing the problem, success criteria and security assumptions.
2. **What:** Commit functional code with a focused message; use a PR when a review gate adds value.
3. **Proof:** Link actual command/test output and GitHub Actions; say explicitly when proof
   is simulated, on a disposable VM, or production/real-account.
4. **State:** Update the relevant Issue/roadmap checkpoint and add a brief journal
   entry for milestones, architectural choices, discovered bugs or resolved blockers.

Small refactors do not need new Issues. These records should document construction
without forcing any agent or ChatGPT user to switch to a separate task-queue workflow.

### Standard journal entry

```markdown
### YYYY-MM-DD — Change / decision

**Problem:**
**Implementation:**
**Evidence:** commit(s), Issue link, GitHub Actions run, scoped test
**Limit / remaining risk:**
**Next gate:**
```

### Redaction rules

Do not publish local user home paths, private usernames, machine IDs, live process
environment, Tunnel IDs/keys, OpenAI or other model/API tokens, real DPAPI blobs,
private source files or full console logs. Record sanitized findings, versioned
test fixtures and their exact scope instead. **Private GitHub repos still require
secrets hygiene** because they may later become public.
