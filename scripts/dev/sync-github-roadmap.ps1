[CmdletBinding()]
param([switch]$DryRun)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$repo='ndshuge/micehole'
$items=@(
  [pscustomobject]@{Key='W2-IPC';Title='[W2] Authenticated Broker-Worker IPC and restrictive pipe ACL';Milestone=1;Labels=@('priority:P0','area:worker','area:security');Summary='Enforce a kernel-backed Windows client SID and restrictive named-pipe DACL. Reject forged identity and fail closed on missing Worker.';Verify='Negative SID/ACL/replay/disconnect tests; sanitized GitHub Actions evidence. Never execute commands in Broker as fallback.'}
  [pscustomobject]@{Key='W2-EXEC';Title='[W2] Restricted Worker command, Git, validation and process-tree management';Milestone=1;Labels=@('priority:P0','area:worker','area:security');Summary='Run approved development jobs only under a constrained Windows identity with project-scoped ACLs, bounded output, cancellation and descendant cleanup.';Verify='Prove read denial on Broker files; run a real compile/test in a disposable workspace; test forced stop and rollback.'}
  [pscustomobject]@{Key='W2-GATE';Title='[W2] Real credential isolation and fail-closed remote tool unlock';Milestone=1;Labels=@('priority:P0','area:security','status:blocked');Summary='Do not expose remote shell/Git/process/validation until Worker Windows token, Broker credential ACL and consent all pass. Revoke access on loss of safety attestation.';Verify='Different SID must not read disposable Broker Tunnel key. Negative attestation tests. Remote falls back to five file/status tools, never same-user arbitrary shell.'}
  [pscustomobject]@{Key='BETA-PAIR';Title='[Beta] Independent user Windows install, private Tunnel and ChatGPT pairing';Milestone=2;Labels=@('priority:P0','area:onboarding','area:testing');Summary='Another person installs EXE, creates own Secure MCP Tunnel, creates own private ChatGPT plugin and completes edit -> test -> fix -> report.';Verify='Test permissions on eligible ChatGPT account, clean revocation and uninstall. Record only redacted proof. No public plugin catalog.'}
  [pscustomobject]@{Key='BETA-UX';Title='[Beta] Setup wizard, Doctor, consent and credential revocation';Milestone=2;Labels=@('priority:P1','area:onboarding','area:security');Summary='First-run graphical pairing, explicit workspace approval, readable diagnostic and lifecycle controls without requiring PowerShell knowledge.';Verify='Fresh-user GUI walkthrough, redacted error report, no silent background access; remove/revoke runtime key and Tunnel configuration safely.'}
  [pscustomobject]@{Key='STABLE-RECOVERY';Title='[Stable] Reboot, logon, sleep/wake and proxy recovery';Milestone=3;Labels=@('priority:P1','area:reliability','area:testing');Summary='Prove actual MiceHole background survival, not only a synthetic Windows boot marker. No changes to owner production services.';Verify='Disposable real reboot, logged-off/on conditions, DPAPI scheduled context, sleep/wake, network outage and no orphan process.'}
  [pscustomobject]@{Key='STABLE-DIST';Title='[Stable] Updater, rollback, signed release checks and security review';Milestone=3;Labels=@('priority:P1','area:security','area:testing');Summary='Versioned portable/installer releases, upgrade rollback, verified dependency licenses, Defender/SmartScreen notes and independent security assessment.';Verify='Clean Windows user upgrades, rollback and uninstall. Published redacted logs and SHA256; no public repository/release without owner approval.'}
)
# This script is an audit-friendly idempotent sync; it is NOT a task queue or build coordinator.
# No secrets, private paths, token files or owner account identifiers are sent in Issue bodies.
$existingJson= & gh issue list --repo $repo --state all --limit 200 --json number,title,url,milestone
if($LASTEXITCODE -ne 0){throw 'Cannot list issues with GitHub CLI'}
$existing=if(($existingJson | Out-String).Trim() -eq '[]'){@()}else{@($existingJson|ConvertFrom-Json)}
foreach($item in $items){
  $found=@($existing|Where-Object {$_.title -eq $item.Title})
  if($found.Count -gt 0){
    Write-Output ('EXISTS '+$found[0].number+' '+$item.Title)
    continue
  }
  if($DryRun){Write-Output ('WOULD_CREATE '+$item.Title);continue}
  $body= @"
## Objective
$($item.Summary)

## Acceptance evidence
$($item.Verify)

## Traceability
Development journal: https://github.com/ndshuge/micehole/blob/main/docs/DEVLOG.md . Security gate: https://github.com/ndshuge/micehole/blob/main/docs/WORKER_ISOLATION.md .

This is a release-quality tracking issue, **not** a queue handoff; the active developer continues construction directly. Never post keys, local usernames, personal directories, complete private logs or screenshots with secrets.
"@
  $tmp=Join-Path ([IO.Path]::GetTempPath()) ('micehole-issue-'+[Guid]::NewGuid().ToString('N')+'.md')
  try{
    # UTF-8 no BOM for clean GitHub issue body.
    [IO.File]::WriteAllText($tmp,$body,(New-Object System.Text.UTF8Encoding($false)))
    $milestoneTitle=@{1='M1 - Secure Remote Worker';2='M2 - Independent User Beta';3='M3 - Stable Self-hosted Release'}[[int]$item.Milestone]
    $args=@('issue','create','--repo',$repo,'--title',$item.Title,'--body-file',$tmp,'--milestone',$milestoneTitle)
    foreach($label in $item.Labels){$args+=@('--label',$label)}
    $output= & gh @args
    if($LASTEXITCODE -ne 0){throw ('Issue create failed for '+$item.Title)}
    Write-Output ('CREATED '+$output.Trim())
  }finally{Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue}
}
