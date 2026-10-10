[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$cpu=@(Get-CimInstance Win32_Processor|Select-Object -First 1)[0]
$system=Get-CimInstance Win32_ComputerSystem
$feature=$null
try{$feature=Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -ErrorAction Stop}catch{}
$vmms=Get-Service vmms -ErrorAction SilentlyContinue
$vmcmd=Get-Command New-VM -ErrorAction SilentlyContinue
# Read-only: never enable Windows features, create a VM or reboot a runner.
$report=[ordered]@{
  source='GitHub-hosted Windows runner'
  host_reboot_attempted=$false
  nested_vm_created=$false
  os=[Environment]::OSVersion.VersionString
  machine_type=[string]$system.Model
  hypervisor_present=[bool]$system.HypervisorPresent
  vm_monitor_extensions=[bool]$cpu.VMMonitorModeExtensions
  second_level_address_translation=[bool]$cpu.SecondLevelAddressTranslationExtensions
  virtualization_firmware_enabled=[bool]$cpu.VirtualizationFirmwareEnabled
  hyperv_feature_state=$(if($feature){[string]$feature.State}else{'unavailable'})
  hyperv_vmms_present=$null -ne $vmms
  hyperv_newvm_cmd_available=$null -ne $vmcmd
  nested_guest_reboot_test_ready=($null -ne $vmcmd -and $null -ne $vmms -and [bool]$cpu.VirtualizationFirmwareEnabled -and [bool]$cpu.VMMonitorModeExtensions -and [bool]$cpu.SecondLevelAddressTranslationExtensions)
  nested_windows_guest_image_available=$false
  caveat='Hyper-V cmdlets alone do not prove guest virtualization works. Nested virtualization is not guaranteed on GitHub-hosted runners.'
}
$destination=Join-Path $PSScriptRoot '..\..\qa-fixture\github-nested-capability.json'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination)|Out-Null
$report|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $destination -Encoding UTF8
$report|ConvertTo-Json -Compress
