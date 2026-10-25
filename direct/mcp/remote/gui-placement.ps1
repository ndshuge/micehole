param(
  [ValidateSet("snapshot", "place", "launch", "reconcile")][string]$Mode = "snapshot",
  [string]$Executable = "",
  [string]$Arguments = "",
  [string]$ProcessName = "msedge",
  [string]$KnownHandles = "",
  [int]$ExpectedPid = 0,
  [ValidateRange(0, 5000)][int]$WaitMs = 2200
)
$ErrorActionPreference = "Stop"
# The launcher is a separate PowerShell path; a running old MCP process may
# still invoke it. Protect gameplay here too, even before service reload.
if ($Mode -eq "launch") {
  if ($env:MOUSE_HOLE_GUI_GAME_LOCK -eq 'on') { throw "Manual gaming lock active; GUI launch refused" }
  $py = if ($env:HANAKO_PYTHON) { $env:HANAKO_PYTHON } else { 'python' }
  $raw = & $py -u (Join-Path $PSScriptRoot 'gui-safety-probe.py') 2>&1
  if ($LASTEXITCODE -ne 0) { throw "GUI launch blocked: safety probe failed" }
  try { $safety = (($raw | Out-String).Trim() | ConvertFrom-Json) }
  catch { throw "GUI launch blocked: invalid safety probe" }
  if ($null -eq $safety -or $null -eq $safety.idle_ms -or
      $safety.block_foreground -isnot [bool] -or
      $safety.game_running -isnot [bool] -or
      $safety.fullscreen_foreground -isnot [bool]) {
    throw "GUI launch blocked: incomplete safety state"
  }
  if ($safety.block_foreground -or $safety.game_running -or $safety.fullscreen_foreground) {
    throw "GUI launch blocked: game or fullscreen application active"
  }
  if ([int64]$safety.idle_ms -lt 900) { throw "GUI launch deferred: user currently interacting" }
}

[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class MouseHolePlacementNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct Rect { public int Left, Top, Right, Bottom; }
  public sealed class Window {
    public long Handle { get; set; }
    public uint ProcessId { get; set; }
    public int Left { get; set; }
    public int Top { get; set; }
    public int Right { get; set; }
    public int Bottom { get; set; }
  }
  private delegate bool EnumProc(IntPtr hwnd, IntPtr unused);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc cb, IntPtr unused);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowTextLength(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr hwnd, int command);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] private static extern bool IsZoomed(IntPtr hwnd);
  [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr hwnd, int show);
  [DllImport("user32.dll", SetLastError=true)] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
  public static Window[] List() {
    var windows = new List<Window>();
    EnumWindows((hwnd, unused) => {
      if (!IsWindowVisible(hwnd) || IsIconic(hwnd) || GetWindow(hwnd, 4) != IntPtr.Zero || GetWindowTextLength(hwnd) <= 0) return true;
      Rect r;
      if (!GetWindowRect(hwnd, out r) || r.Right-r.Left < 160 || r.Bottom-r.Top < 100) return true;
      uint pid; GetWindowThreadProcessId(hwnd, out pid);
      windows.Add(new Window { Handle=hwnd.ToInt64(), ProcessId=pid, Left=r.Left, Top=r.Top, Right=r.Right, Bottom=r.Bottom });
      return true;
    }, IntPtr.Zero);
    return windows.ToArray();
  }
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] private static extern bool SetProp(IntPtr hwnd, string key, IntPtr value);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern IntPtr GetProp(IntPtr hwnd, string key);
  private const string OwnerKey = "MiceHoleVerifiedAgentQuarterWindowV1";
  public static bool MarkOwned(long handle) { return SetProp(new IntPtr(handle), OwnerKey, new IntPtr(1)); }
  public static bool IsOwned(long handle) { return GetProp(new IntPtr(handle), OwnerKey) == new IntPtr(1); }
  public static bool Move(long handle, int x, int y, int w, int h) {
    var hwnd=new IntPtr(handle);
    if (IsZoomed(hwnd)) ShowWindowAsync(hwnd, 9); // restore new maximized window
    return SetWindowPos(hwnd, IntPtr.Zero, x, y, w, h, 0x0014); // do not raise or activate
  }
}
"@
# The native enumerator and WinForms screen coordinates must both be physical pixels.
$oldDpi = [MouseHolePlacementNative]::SetThreadDpiAwarenessContext([IntPtr](-4))
if ($oldDpi -eq [IntPtr]::Zero) { throw "Per-monitor DPI awareness unavailable; placement skipped" }

function Get-TargetWindows {
  $pids = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | ForEach-Object { [uint32]$_.Id })
  if ($pids.Count -eq 0) { return @() }
  return @([MouseHolePlacementNative]::List() | Where-Object { $pids -contains $_.ProcessId })
}
function Intersect-Area($a, $b) {
  $w = [Math]::Max(0, [Math]::Min($a.Right, $b.Right) - [Math]::Max($a.Left, $b.Left))
  $h = [Math]::Max(0, [Math]::Min($a.Bottom, $b.Bottom) - [Math]::Max($a.Top, $b.Top))
  return ($w * $h)
}

if ($Mode -eq "snapshot") {
  $handles = @(Get-TargetWindows | ForEach-Object { $_.Handle })
  @{ok=$true; handles=$handles} | ConvertTo-Json -Depth 4 -Compress
  exit 0
}

function Get-QuarterSlots($work) {
  $halfW = [int][Math]::Floor($work.Width / 2)
  $halfH = [int][Math]::Floor($work.Height / 2)
  if ($halfW -lt 480 -or $halfH -lt 280) { return @() }
  return @(
    @{name="top_right"; left=($work.Left+$halfW); top=$work.Top; right=$work.Right; bottom=($work.Top+$halfH)},
    @{name="top_left"; left=$work.Left; top=$work.Top; right=($work.Left+$halfW); bottom=($work.Top+$halfH)},
    @{name="bottom_right"; left=($work.Left+$halfW); top=($work.Top+$halfH); right=$work.Right; bottom=$work.Bottom},
    @{name="bottom_left"; left=$work.Left; top=($work.Top+$halfH); right=($work.Left+$halfW); bottom=$work.Bottom}
  )
}
function Test-QuarterAligned($window, $slots) {
  foreach ($slot in $slots) {
    if ([Math]::Abs($window.Left-$slot.left) -le 24 -and [Math]::Abs($window.Top-$slot.top) -le 24 -and
        [Math]::Abs($window.Right-$slot.right) -le 24 -and [Math]::Abs($window.Bottom-$slot.bottom) -le 24) { return $true }
  }
  return $false
}
function Select-Quarter($slots, $obstacles) {
  $best=$null
  $bestCoverage=[double]::PositiveInfinity
  foreach ($slot in $slots) {
    $area=($slot.right-$slot.left)*($slot.bottom-$slot.top)
    $occupied=0.0
    foreach ($window in $obstacles) { $occupied += Intersect-Area $slot $window }
    $coverage=$occupied / $area
    if ($coverage -lt $bestCoverage - 0.0000001) { $bestCoverage=$coverage; $best=$slot }
  }
  return @{slot=$best; coverage=$bestCoverage}
}
function New-WindowBounds($original, $slot) {
  return @{ Handle=$original.Handle; ProcessId=$original.ProcessId;
    Left=[int]$slot.left; Top=[int]$slot.top; Right=[int]$slot.right; Bottom=[int]$slot.bottom }
}
function Invoke-OwnedWindowPlacement {
# For other Agent-owned GUI apps, launch and place in one call without a new MCP tool.
if ($Mode -eq "launch") {
  if ([string]::IsNullOrWhiteSpace($Executable)) { throw "Executable is required for launch" }
  $ProcessName = [IO.Path]::GetFileNameWithoutExtension($Executable)
  $KnownHandles = (@(Get-TargetWindows | ForEach-Object { $_.Handle }) -join ",")
  $launchArgs = @{ FilePath = $Executable; PassThru = $true }
  if (-not [string]::IsNullOrWhiteSpace($Arguments)) { $launchArgs.ArgumentList = $Arguments }
  # Preflight BEFORE spawning: otherwise a rejected placement still leaves a visible new window.
  $preScreen = [System.Windows.Forms.Screen]::PrimaryScreen
  $preSlots = @(Get-QuarterSlots $preScreen.WorkingArea)
  if ($preSlots.Count -ne 4) { throw "GUI launch blocked: display too small for quarter-screen placement" }
  $preObstacles = @([MouseHolePlacementNative]::List() | Where-Object {
    $_.ProcessId -notin @(Get-Process -Name TextInputHost,ShellExperienceHost,StartMenuExperienceHost,SearchHost -ErrorAction SilentlyContinue | ForEach-Object { [uint32]$_.Id })
  })
  $preChoice = Select-Quarter $preSlots $preObstacles
  if ($null -eq $preChoice.slot -or $preChoice.coverage -gt 0.05) {
    throw "GUI launch blocked: no free quadrant; refusing to stack on existing windows"
  }
  $started = Start-Process @launchArgs
  $ExpectedPid = $started.Id
}
if ($Mode -eq "place" -and $ExpectedPid -le 0) { throw "ExpectedPid is required to prove new window ownership" }
# 2026-10-20 user default: new Agent-owned foreground GUI uses free quarter-screen placement.
# Only explicit MOUSE_HOLE_GUI_LAYOUT=off disables it; existing windows remain untouched.
if ($env:MOUSE_HOLE_GUI_LAYOUT -eq 'off') {
  @{ok=$true; placed=$false; launched_pid=$ExpectedPid; reason="layout_disabled"} | ConvertTo-Json -Compress
  return
}
$known = [Collections.Generic.HashSet[long]]::new()
foreach ($value in $KnownHandles.Split(",")) {
  $parsed = [long]0
  if ([long]::TryParse($value, [ref]$parsed)) { [void]$known.Add($parsed) }
}
if ($Mode -eq "reconcile") {
  # Reconcile only a previously tagged live Mice Hole-owned window with verified PID.
  if ($ExpectedPid -le 0) { throw "ExpectedPid is required for reconcile" }
  $candidates = @(Get-TargetWindows | Where-Object {
    $_.ProcessId -eq $ExpectedPid -and [MouseHolePlacementNative]::IsOwned([long]$_.Handle)
  })
} else {
  $deadline = [DateTime]::UtcNow.AddMilliseconds($WaitMs)
  $candidates = @()
  do {
    $candidates = @(Get-TargetWindows | Where-Object {
      -not $known.Contains([long]$_.Handle) -and ($ExpectedPid -le 0 -or $_.ProcessId -eq $ExpectedPid)
    })
    if ($candidates.Count -gt 0 -or [DateTime]::UtcNow -ge $deadline) { break }
    Start-Sleep -Milliseconds 120
  } while ($true)
}
if ($candidates.Count -ne 1) {
  $reason = if ($Mode -eq "reconcile") {
    if ($candidates.Count -eq 0) {"not_owned_or_not_found"} else {"ambiguous_owned_windows"}
  } elseif ($candidates.Count -eq 0) {"no_new_window"} else {"ambiguous_new_windows"}
  @{ok=$true; placed=$false; launched_pid=$ExpectedPid; reason=$reason} | ConvertTo-Json -Compress
  return
}
$target = $candidates[0]
$screen = [System.Windows.Forms.Screen]::FromHandle([IntPtr]$target.Handle)
$slots = @(Get-QuarterSlots $screen.WorkingArea)
if ($slots.Count -ne 4) {
  @{ok=$true; placed=$false; launched_pid=$ExpectedPid; reason="quadrant_too_small"} | ConvertTo-Json -Compress
  return
}
$systemOverlayPids = @(Get-Process -Name TextInputHost,ShellExperienceHost,StartMenuExperienceHost,SearchHost -ErrorAction SilentlyContinue | ForEach-Object { [uint32]$_.Id })
$others = @([MouseHolePlacementNative]::List() | Where-Object {
  $_.Handle -ne $target.Handle -and $systemOverlayPids -notcontains $_.ProcessId
})
# Earlier tagged Mice Hole windows centered across quadrants must not block all slots.
# Reflow only tagged windows on same display, never untagged user or other-Agent windows.
$irregular = @($others | Where-Object {
  [MouseHolePlacementNative]::IsOwned([long]$_.Handle) -and
  [System.Windows.Forms.Screen]::FromHandle([IntPtr]$_.Handle).DeviceName -eq $screen.DeviceName -and
  -not (Test-QuarterAligned $_ $slots)
})
$reflowHandles = [Collections.Generic.HashSet[long]]::new()
foreach ($window in $irregular) { [void]$reflowHandles.Add([long]$window.Handle) }
$fixed = [Collections.Generic.List[object]]::new()
foreach ($window in $others) {
  if (-not $reflowHandles.Contains([long]$window.Handle)) { $fixed.Add($window) }
}
$reflowed = 0
foreach ($window in $irregular) {
  $selection = Select-Quarter $slots $fixed
  if ($null -ne $selection.slot -and $selection.coverage -le 0.05 -and [MouseHolePlacementNative]::Move([long]$window.Handle,
      [int]$selection.slot.left, [int]$selection.slot.top,
      [int]($selection.slot.right-$selection.slot.left), [int]($selection.slot.bottom-$selection.slot.top))) {
    $fixed.Add((New-WindowBounds $window $selection.slot))
    $reflowed++
  } else { $fixed.Add($window) }
}
$choice = Select-Quarter $slots $fixed
$best = $choice.slot
if ($null -eq $best -or $choice.coverage -gt 0.05) {
  @{ok=$true; placed=$false; launched_pid=$ExpectedPid; reason="no_free_quadrant_overlap_refused"} | ConvertTo-Json -Compress
  return
}
$width = [int]($best.right-$best.left)
$height = [int]($best.bottom-$best.top)
if (-not [MouseHolePlacementNative]::Move([long]$target.Handle,[int]$best.left,[int]$best.top,$width,$height)) {
  throw "SetWindowPos failed; existing windows were left untouched"
}
$marked = [MouseHolePlacementNative]::IsOwned([long]$target.Handle) -or
  [MouseHolePlacementNative]::MarkOwned([long]$target.Handle)
# No occupied-quadrant stacking: moves above require <= 5% coverage.
@{ok=$true; placed=$true; slot=$best.name; window_handle=$target.Handle;
  bounds=@{x=$best.left;y=$best.top;width=$width;height=$height};
  launched_pid=$ExpectedPid; owner_marked=[bool]$marked;
  reflowed_owned_windows=$reflowed; overlap_unavoidable=($choice.coverage -gt 0.12);
  coverage_before=[Math]::Round([double]$choice.coverage,4)} | ConvertTo-Json -Depth 4 -Compress
}
# A cross-process mutex serializes launches from distinct Agent/plugin sessions.
# The mutex covers the snapshot, spawn, occupancy check and placement.
$layoutMutex = [Threading.Mutex]::new($false, 'Local\MouseHoleGuiPlacement')
$mutexHeld = $false
try {
  try { $mutexHeld = $layoutMutex.WaitOne(5500) }
  catch [Threading.AbandonedMutexException] { $mutexHeld = $true }
  if (-not $mutexHeld) { throw "GUI placement busy; no process launched" }
  Invoke-OwnedWindowPlacement
} finally {
  if ($mutexHeld) { [void]$layoutMutex.ReleaseMutex() }
  $layoutMutex.Dispose()
}
