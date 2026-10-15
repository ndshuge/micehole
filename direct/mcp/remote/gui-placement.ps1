param(
  [ValidateSet("snapshot", "place", "launch")][string]$Mode = "snapshot",
  [string]$Executable = "",
  [string]$Arguments = "",
  [string]$ProcessName = "msedge",
  [string]$KnownHandles = "",
  [int]$ExpectedPid = 0,
  [ValidateRange(0, 5000)][int]$WaitMs = 2200
)
$ErrorActionPreference = "Stop"
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

function Invoke-OwnedWindowPlacement {
# For other Agent-owned GUI apps, launch and place in one call without a new MCP tool.
if ($Mode -eq "launch") {
  if ([string]::IsNullOrWhiteSpace($Executable)) { throw "Executable is required for launch" }
  $ProcessName = [IO.Path]::GetFileNameWithoutExtension($Executable)
  $KnownHandles = (@(Get-TargetWindows | ForEach-Object { $_.Handle }) -join ",")
  $launchArgs = @{ FilePath = $Executable; PassThru = $true }
  if (-not [string]::IsNullOrWhiteSpace($Arguments)) { $launchArgs.ArgumentList = $Arguments }
  $started = Start-Process @launchArgs
  $ExpectedPid = $started.Id
}
if ($Mode -eq "place" -and $ExpectedPid -le 0) { throw "ExpectedPid is required to prove new window ownership" }
$known = [Collections.Generic.HashSet[long]]::new()
foreach ($value in $KnownHandles.Split(",")) {
  $parsed = [long]0
  if ([long]::TryParse($value, [ref]$parsed)) { [void]$known.Add($parsed) }
}
$deadline = [DateTime]::UtcNow.AddMilliseconds($WaitMs)
$candidates = @()
do {
  $candidates = @(Get-TargetWindows | Where-Object { -not $known.Contains([long]$_.Handle) -and ($ExpectedPid -le 0 -or $_.ProcessId -eq $ExpectedPid) })
  if ($candidates.Count -gt 0 -or [DateTime]::UtcNow -ge $deadline) { break }
  Start-Sleep -Milliseconds 120
} while ($true)

if ($candidates.Count -ne 1) {
  @{ok=$true; placed=$false; launched_pid=$ExpectedPid; reason=$(if ($candidates.Count -eq 0) {"no_new_window"} else {"ambiguous_new_windows"})} | ConvertTo-Json -Compress
  return
}
$target = $candidates[0]
$screen = [System.Windows.Forms.Screen]::FromHandle([IntPtr]$target.Handle)
$work = $screen.WorkingArea
$halfW = [int][Math]::Floor($work.Width / 2)
$halfH = [int][Math]::Floor($work.Height / 2)
if ($halfW -lt 480 -or $halfH -lt 280) {
  @{ok=$true; placed=$false; launched_pid=$ExpectedPid; reason="quadrant_too_small"} | ConvertTo-Json -Compress
  return
}
$slots = @(
  @{name="top_left"; left=$work.Left; top=$work.Top; right=($work.Left+$halfW); bottom=($work.Top+$halfH)},
  @{name="top_right"; left=($work.Left+$halfW); top=$work.Top; right=$work.Right; bottom=($work.Top+$halfH)},
  @{name="bottom_left"; left=$work.Left; top=($work.Top+$halfH); right=($work.Left+$halfW); bottom=$work.Bottom},
  @{name="bottom_right"; left=($work.Left+$halfW); top=($work.Top+$halfH); right=$work.Right; bottom=$work.Bottom}
)
$systemOverlayPids = @(Get-Process -Name TextInputHost,ShellExperienceHost,StartMenuExperienceHost,SearchHost -ErrorAction SilentlyContinue | ForEach-Object { [uint32]$_.Id })
$others = @([MouseHolePlacementNative]::List() | Where-Object { $_.Handle -ne $target.Handle -and $systemOverlayPids -notcontains $_.ProcessId })
$best = $null
$bestCoverage = [double]::PositiveInfinity
foreach ($slot in $slots) {
  $area = ($slot.right-$slot.left)*($slot.bottom-$slot.top)
  $occupied = 0.0
  foreach ($window in $others) { $occupied += Intersect-Area $slot $window }
  $coverage = $occupied / $area
  if ($coverage -lt $bestCoverage) { $bestCoverage=$coverage; $best=$slot }
}
# Four occupied quadrants: leave the new window exactly where Windows placed it.
if ($bestCoverage -gt 0.12) {
  @{ok=$true; placed=$false; launched_pid=$ExpectedPid; reason="no_free_quadrant"} | ConvertTo-Json -Compress
  return
}
$width = [int]($best.right-$best.left)
$height = [int]($best.bottom-$best.top)
if (-not [MouseHolePlacementNative]::Move($target.Handle,[int]$best.left,[int]$best.top,$width,$height)) {
  throw "SetWindowPos failed; existing windows were left untouched"
}
@{ok=$true; placed=$true; slot=$best.name; window_handle=$target.Handle; bounds=@{x=$best.left;y=$best.top;width=$width;height=$height}; launched_pid=$ExpectedPid} | ConvertTo-Json -Depth 4 -Compress
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
