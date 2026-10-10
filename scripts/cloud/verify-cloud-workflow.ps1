[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$workflow=Get-Content -LiteralPath (Join-Path $repo '.github\workflows\azure-persistent-reboot.yml') -Raw
$probe=Get-Content -LiteralPath (Join-Path $repo '.github\workflows\cloud-reboot-capability.yml') -Raw
$required=@(
 'plan_only','reboot_existing_qa_vm','micehole-purpose','reboot-qa',
 'micehole-reboot-ok','az vm restart','azure/login@v2',
 'MICEHOLE_AZURE_QA_RESOURCE_GROUP','MICEHOLE_AZURE_QA_VM_NAME',
 'azure-reboot-prepare.ps1','azure-reboot-verify.ps1','azure-reboot-cleanup.ps1',
 'steps.vm_guard.outcome'
)
foreach($item in $required){
  if(-not $workflow.Contains($item)){throw ('Missing cloud safety contract: '+$item)}
}
if($workflow -notmatch '(?m)^\s*default:\s*plan_only\s*$') {throw 'Plan-only must be the default'}
if($workflow -notmatch 'if:\s*\$\{\{\s*inputs\.mode\s*==\s*''reboot_existing_qa_vm''\s*\}\}') {
  throw 'Real reboot job must require explicit manual mode'
}
if($workflow -notmatch 'id-token:\s*write') {throw 'Azure must authenticate via OIDC'}
if($workflow -notmatch 'jq -e.*micehole-purpose') {throw 'VM reboot must be guarded by ownership tags'}
if($probe -match 'Restart-Computer|az vm restart') {throw 'Hosted-runner capability probe must not reboot Windows'}
foreach($file in @('probe-nested-virtualization.ps1','azure-reboot-prepare.ps1','azure-reboot-verify.ps1','azure-reboot-cleanup.ps1')) {
  $path=Join-Path $PSScriptRoot $file
  $tokens=$null;$errors=$null
  [void][System.Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$errors)
  if($errors.Count -gt 0) {throw ('PowerShell syntax invalid: '+$file+' '+$errors[0].Message)}
}
Write-Output 'CLOUD_REBOOT_WORKFLOW_CONTRACT=PASS'
Write-Output 'NO_CLOUD_RESOURCE_CREATED_BY_VALIDATION=PASS'
