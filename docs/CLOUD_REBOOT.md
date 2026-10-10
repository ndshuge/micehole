# Cloud Windows reboot verification / 云端重启验收

**Current status: infrastructure prepared, REAL cloud reboot not executed.**
No Azure credentials, dedicated cloud VM or GitHub Actions configuration was present
in the repository at the time this workflow was added.

## GitHub standard Windows runner probe

The read-only `cloud-reboot-capability.yml` workflow checks whether a normal
`windows-latest` runner might support nested Hyper-V.

- It does **not** reboot the GitHub-hosted runner, modify Windows features or
  create a guest VM.
- The first observed Windows Runner reported Hyper-V tooling and `vmms`, but
  **VMMonitorModeExtensions=false and SLAT=false**. Merely having Hyper-V cmdlets
  is not proof that a guest Windows VM can be started.
- GitHub's own documentation does not guarantee nested virtualization.
- A fresh Windows VM created for each GitHub Actions job is automatically
  decommissioned after that job. Separate workflow jobs are not proof of an
  in-place reboot of the same Windows machine.

## Real-reboot workflow (bring your own isolated Azure VM)

`.github/workflows/azure-persistent-reboot.yml` supports two modes:

1. `plan_only` (default): checks variable names for completeness. **No Azure login,
   VM creation, restart or costs**.
2. `reboot_existing_qa_vm`: OIDC login, verify the **existing dedicated QA VM**
   has both ownership tags, create a disposable boot marker task inside it, request
   `az vm restart`, verify post-boot task execution and a changed Windows boot
   timestamp from *outside* the VM, remove the task, and optionally deallocate it.

The reboot mode requires an *already-created* isolated Azure **Windows** VM.
This workflow does NOT create a VM or silently purchase any resources.

### Configure once, outside ChatGPT messages

1. In your own Azure subscription, provision a **dedicated disposable Windows VM**
   with no production data. An inbound public RDP port is unnecessary: Azure
   `Run Command` operates through the Azure VM agent. The VM and disk may incur
   charges, even if the VM is later deallocated.
2. Apply BOTH of these exact tags to the dedicated VM:
   - `micehole-purpose=reboot-qa`
   - `micehole-reboot-ok=true`
   The workflow refuses any other VM.
3. Configure an Azure Entra workload-identity federation from the repository
   `ndshuge/micehole` to a service principal or managed identity with the least
   necessary rights to **read, run commands, restart and deallocate only that
   dedicated VM**. For an environment-qualified job, federated subject will be
   `repo:ndshuge/micehole:environment:cloud-reboot-qa`.
4. Create the GitHub environment `cloud-reboot-qa`; use reviewers if the
   repository's GitHub plan permits it. Set the following **repository-level**
   GitHub Actions variables (the plan-only job reads repository variables):
   - `MICEHOLE_AZURE_CLIENT_ID`
   - `MICEHOLE_AZURE_TENANT_ID`
   - `MICEHOLE_AZURE_SUBSCRIPTION_ID`
   - `MICEHOLE_AZURE_QA_RESOURCE_GROUP`
   - `MICEHOLE_AZURE_QA_VM_NAME`
   These are public identifiers, not runtime API keys or passwords. Do not place
   any Azure client secrets or Windows administrator passwords in source code.
5. First dispatch the workflow with `mode=plan_only`. Only after VM isolation
   and permissions are checked should you dispatch `mode=reboot_existing_qa_vm`.
   `deallocate_after=true` is the default to reduce ongoing compute charges.

### What this test proves

- A *persistent*, explicitly tagged Windows Azure VM **actually booted again**,
  demonstrated by a changed `Win32_OperatingSystem.LastBootUpTime`.
- Its **temporary** Windows startup scheduled task ran on that new boot.
- GitHub Actions observed the before/after evidence from outside the VM.

### What it does NOT prove (must be separate tests)

- MiceHole's *real* user-logon Supervisor survives a restart and has a valid
  Tunnel credential in a non-interactive session. The current Supervisor uses
  an interactive-user task; unattended boot before that user logs in is a
  distinct scenario and must not be called a successful product restart test.
- The genuine MiceHole Setup.exe is installed on the Azure VM. The private
  repository cannot be anonymously downloaded to the VM, and we intentionally
  do not send GitHub tokens or real OpenAI Tunnel keys to it.
- A personal OpenAI Secure MCP Tunnel automatically reconnects after restart;
  or that a real third-party ChatGPT account can discover and use writable tools.
- Same-user DPAPI credential access has been isolated from an AI Worker.
  **Do not re-enable remote shell tools based solely on cloud reboot results.**

## Failure safety

- No public network ports are opened or RDP enabled.
- This workflow will not run reboot logic unless the operator explicitly selects
  `reboot_existing_qa_vm`, Azure OIDC authentication succeeds, and BOTH approval
  tags match.
- Cleanup/deallocation are gated on the positive ownership and preparation checks.
- Best-effort evidence is uploaded as a GitHub Actions artifact.
- If Azure is unavailable, report the blocker honestly; never reboot the
  user's physical Windows computer or substitute a mock for a real reboot.

Useful references:

- https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- https://learn.microsoft.com/en-us/azure/virtual-machines/windows/run-command
- https://learn.microsoft.com/en-us/cli/azure/vm
