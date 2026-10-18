param(
  [Parameter(Mandatory=$true)][string]$Operation,
  [int]$X = 0,
  [int]$Y = 0,
  [int]$X2 = 0,
  [int]$Y2 = 0,
  [int]$Delta = 0,
  [string]$Text = "",
  [string]$Title = "",
  [string]$Keys = "",
  [int]$DurationMs = 0
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
public static class HanakoGuiNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }

  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int command);
  [DllImport("user32.dll", EntryPoint = "FindWindowW", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(IntPtr className, string windowName);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiContext);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extraInfo);
  [DllImport("user32.dll", EntryPoint = "GetClassNameW", CharSet = CharSet.Unicode)]
  public static extern int GetClassName(IntPtr hwnd, StringBuilder buffer, int limit);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumWindowProc callback, IntPtr data);
  public delegate bool EnumWindowProc(IntPtr handle, IntPtr data);
  [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern IntPtr SendMessageTimeout(IntPtr handle, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint milliseconds, out IntPtr result);
  public static IntPtr FindUniqueExactButton(IntPtr parent, string caption) {
    if (parent == IntPtr.Zero || String.IsNullOrWhiteSpace(caption)) throw new InvalidOperationException("Exact button caption required");
    var buttons = new List<IntPtr>();
    EnumWindowProc scan = (handle, unused) => {
      var text = new StringBuilder(512);
      var cls = new StringBuilder(256);
      GetWindowText(handle,text,text.Capacity);
      GetClassName(handle,cls,cls.Capacity);
      var name=cls.ToString();
      if (String.Equals(text.ToString(),caption,StringComparison.Ordinal)
          && (String.Equals(name,"Button",StringComparison.OrdinalIgnoreCase)
            || name.StartsWith("WindowsForms10.BUTTON.",StringComparison.OrdinalIgnoreCase))) {
        buttons.Add(handle);
      }
      return buttons.Count<=1;
    };
    EnumChildWindows(parent,scan,IntPtr.Zero);
    if(buttons.Count != 1) throw new InvalidOperationException("Expected exactly one matching native Button child, got "+buttons.Count);
    var result=buttons[0];
    if(GetAncestor(result,2)!=parent || !IsWindowVisible(result) || !IsWindowEnabled(result)) throw new InvalidOperationException("Target button not eligible or not owned by exact window");
    return result;
  }
  public static void InvokeExactButton(IntPtr button) {
    IntPtr result;
    if (SendMessageTimeout(button,0x00F5,IntPtr.Zero,IntPtr.Zero,2,1500,out result)==IntPtr.Zero)
      throw new InvalidOperationException("Native BM_CLICK timed out/failed; do not claim action succeeded");
  }

  public const uint LEFTDOWN = 0x0002;
  public const uint LEFTUP = 0x0004;
  public const uint RIGHTDOWN = 0x0008;
  public const uint RIGHTUP = 0x0010;
  public const uint WHEEL = 0x0800;
}
"@

function Get-GuiState {
  $p = New-Object HanakoGuiNative+POINT
  [void][HanakoGuiNative]::GetCursorPos([ref]$p)
  $hwnd = [HanakoGuiNative]::GetForegroundWindow()
  $sb = New-Object System.Text.StringBuilder 1024
  [void][HanakoGuiNative]::GetWindowText($hwnd, $sb, $sb.Capacity)
  $state = @{
    cursor = @{ x = $p.X; y = $p.Y }
    foreground_title = $sb.ToString()
    foreground_handle = $hwnd.ToInt64()
  }
  if (-not [string]::IsNullOrWhiteSpace($Title)) {
    $target = [HanakoGuiNative]::FindWindow([IntPtr]::Zero,$Title)
    $state.target = @{ title = $Title; exists = ($target -ne [IntPtr]::Zero); foreground = ($target -ne [IntPtr]::Zero -and $target -eq $hwnd) }
    if ($target -ne [IntPtr]::Zero) {
      $bounds = New-Object HanakoGuiNative+RECT
      if ([HanakoGuiNative]::GetWindowRect($target,[ref]$bounds)) {
        $state.target.bounds_physical = @{ left=$bounds.Left; top=$bounds.Top; right=$bounds.Right; bottom=$bounds.Bottom }
      }
      $state.target.visible = [HanakoGuiNative]::IsWindowVisible($target)
      if ($X -ne 0 -or $Y -ne 0) {
        $check = New-Object HanakoGuiNative+POINT
        $check.X=$X; $check.Y=$Y
        $root = [HanakoGuiNative]::GetAncestor([HanakoGuiNative]::WindowFromPoint($check),[uint32]2)
        $state.target.point_hits_target = ($root -eq $target)
      }
    }
  }
  return $state
}

# Coordinate operations are never issued without an exact target window identity.
# Reject occluded/stale/DPI-ambiguous coordinates BEFORE moving or clicking.
function Assert-GuiTarget([int]$AtX,[int]$AtY) {
  if ([string]::IsNullOrWhiteSpace($Title)) { throw "Explicit target window Title is required for GUI pointer actions" }
  $target = [HanakoGuiNative]::FindWindow([IntPtr]::Zero,$Title)
  if ($target -eq [IntPtr]::Zero) { throw "Exact target window not found" }
  if (-not [HanakoGuiNative]::IsWindowVisible($target)) { throw "Target window is not visible" }
  $front = [HanakoGuiNative]::GetForegroundWindow()
  if ($front -ne $target) { throw "Target window is not foreground" }
  $rect = New-Object HanakoGuiNative+RECT
  if (-not [HanakoGuiNative]::GetWindowRect($target,[ref]$rect)) { throw "Cannot query target bounds" }
  if ($AtX -lt $rect.Left -or $AtX -ge $rect.Right -or $AtY -lt $rect.Top -or $AtY -ge $rect.Bottom) {
    throw "Requested point lies outside target window physical bounds"
  }
  $point = New-Object HanakoGuiNative+POINT
  $point.X=$AtX; $point.Y=$AtY
  $hit = [HanakoGuiNative]::WindowFromPoint($point)
  $actual = [HanakoGuiNative]::GetAncestor($hit,[uint32]2)
  if ($actual -ne $target) { throw "Target point is occluded by a different window" }
}
function Assert-GuiForeground {
  if ([string]::IsNullOrWhiteSpace($Title)) { throw "Exact target window title required for keyboard input" }
  $target = [HanakoGuiNative]::FindWindow([IntPtr]::Zero,$Title)
  if ($target -eq [IntPtr]::Zero -or [HanakoGuiNative]::GetForegroundWindow() -ne $target) {
    throw "Expected keyboard target is not foreground"
  }
}
# Windows coordinate operations must use physical pixels, not a 150%-scaled logical rectangle.
$oldDpiContext = [HanakoGuiNative]::SetThreadDpiAwarenessContext([IntPtr](-4))
if ($oldDpiContext -eq [IntPtr]::Zero) { throw "Unable to enable per-monitor DPI-aware GUI coordinates" }
function Send-KeysSafe([string]$value) {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.SendKeys]::SendWait($value)
}

# All physical cursor, keyboard and focus operations share one cross-process input gate.
# Semantic BM_CLICK is handled outside this file and never touches global input.
$guiInputLock = $null
$guiInputHeld = $false
if ($Operation -notin @('status', 'wait')) {
  if ($env:MOUSE_HOLE_GUI_FOREGROUND_MODE -ne 'allow') {
    throw "Foreground GUI disabled by default: MOUSE_HOLE_GUI_FOREGROUND_MODE=allow required"
  }
  $guiInputLock = [Threading.Mutex]::new($false, 'Local\MouseHoleGuiInput')
  try {
    try { $guiInputHeld = $guiInputLock.WaitOne(4000) }
    catch [Threading.AbandonedMutexException] { $guiInputHeld = $true }
    if (-not $guiInputHeld) { throw "GUI input busy; retry only when other input ends" }
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MouseHoleUserIdle {
  [StructLayout(LayoutKind.Sequential)]
  public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
  public static uint IdleMs() {
    var info = new LASTINPUTINFO();
    info.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
    if (!GetLastInputInfo(ref info)) throw new InvalidOperationException("Cannot check user activity");
    return unchecked((uint)Environment.TickCount - info.dwTime);
  }
}
"@
    if ([MouseHoleUserIdle]::IdleMs() -lt 3000) {
      throw "User recently active; foreground GUI input deferred"
    }
  } catch {
    if ($guiInputHeld) { [void]$guiInputLock.ReleaseMutex() }
    $guiInputLock.Dispose()
    throw
  }
}
try {
switch ($Operation) {
  "status" {
    $state = Get-GuiState
    [pscustomobject]@{ ok=$true; operation=$Operation; state=$state } | ConvertTo-Json -Compress -Depth 5
    exit 0
  }
  "wait" {
    if ($DurationMs -lt 0 -or $DurationMs -gt 30000) { throw "DurationMs must be between 0 and 30000" }
    Start-Sleep -Milliseconds $DurationMs
  }
  "focus_window" {
    if ([string]::IsNullOrWhiteSpace($Title)) { throw "Title is required" }
    $target = [HanakoGuiNative]::FindWindow([IntPtr]::Zero,$Title)
    if ($target -eq [IntPtr]::Zero) { throw "Exact target window not found" }
    if (-not [HanakoGuiNative]::IsWindowVisible($target)) { throw "Target window is hidden" }
    [void][HanakoGuiNative]::ShowWindowAsync($target,9)
    [void][HanakoGuiNative]::SetForegroundWindow($target)
    $shell = New-Object -ComObject WScript.Shell
    [void]$shell.AppActivate($Title)
    $focused = $false
    for ($i=0;$i -lt 6;$i++) {
      Start-Sleep -Milliseconds 120
      if ([HanakoGuiNative]::GetForegroundWindow() -eq $target) { $focused=$true;break }
    }
    if (-not $focused) { throw "Windows refused to focus exact target window; no further GUI action performed" }
  }
  "move" {
    Assert-GuiTarget $X $Y
    if (-not [HanakoGuiNative]::SetCursorPos($X,$Y)) { throw "SetCursorPos failed" }
  }
  "click" {
    if (-not [string]::IsNullOrWhiteSpace($Text)) {
      if ([string]::IsNullOrWhiteSpace($Title)) { throw "Exact parent window title required for semantic button click" }
      $parent=[HanakoGuiNative]::FindWindow([IntPtr]::Zero,$Title)
      if ($parent -eq [IntPtr]::Zero -or -not [HanakoGuiNative]::IsWindowVisible($parent)) {
        throw "Exact native parent window missing or invisible"
      }
      $button=[HanakoGuiNative]::FindUniqueExactButton($parent,$Text)
      [HanakoGuiNative]::InvokeExactButton($button)
    } else {
      Assert-GuiTarget $X $Y
      if (-not [HanakoGuiNative]::SetCursorPos($X,$Y)) { throw "SetCursorPos failed" }
      [HanakoGuiNative]::mouse_event([HanakoGuiNative]::LEFTDOWN,0,0,0,[UIntPtr]::Zero)
      [HanakoGuiNative]::mouse_event([HanakoGuiNative]::LEFTUP,0,0,0,[UIntPtr]::Zero)
    }
  }
  "double_click" {
    Assert-GuiTarget $X $Y
    if (-not [HanakoGuiNative]::SetCursorPos($X,$Y)) { throw "SetCursorPos failed" }
    1..2 | ForEach-Object {
      [HanakoGuiNative]::mouse_event([HanakoGuiNative]::LEFTDOWN,0,0,0,[UIntPtr]::Zero)
      [HanakoGuiNative]::mouse_event([HanakoGuiNative]::LEFTUP,0,0,0,[UIntPtr]::Zero)
      Start-Sleep -Milliseconds 80
    }
  }
  "right_click" {
    Assert-GuiTarget $X $Y
    if (-not [HanakoGuiNative]::SetCursorPos($X,$Y)) { throw "SetCursorPos failed" }
    [HanakoGuiNative]::mouse_event([HanakoGuiNative]::RIGHTDOWN,0,0,0,[UIntPtr]::Zero)
    [HanakoGuiNative]::mouse_event([HanakoGuiNative]::RIGHTUP,0,0,0,[UIntPtr]::Zero)
  }
  "drag" {
    Assert-GuiTarget $X $Y
    Assert-GuiTarget $X2 $Y2
    if (-not [HanakoGuiNative]::SetCursorPos($X,$Y)) { throw "SetCursorPos failed" }
    [HanakoGuiNative]::mouse_event([HanakoGuiNative]::LEFTDOWN,0,0,0,[UIntPtr]::Zero)
    $steps = 12
    for ($i = 1; $i -le $steps; $i++) {
      $nx = [int][Math]::Round($X + (($X2 - $X) * $i / $steps))
      $ny = [int][Math]::Round($Y + (($Y2 - $Y) * $i / $steps))
      [void][HanakoGuiNative]::SetCursorPos($nx,$ny)
      Start-Sleep -Milliseconds 15
    }
    [HanakoGuiNative]::mouse_event([HanakoGuiNative]::LEFTUP,0,0,0,[UIntPtr]::Zero)
  }
  "scroll" {
    $point = New-Object HanakoGuiNative+POINT
    [void][HanakoGuiNative]::GetCursorPos([ref]$point)
    Assert-GuiTarget $point.X $point.Y
    [HanakoGuiNative]::mouse_event([HanakoGuiNative]::WHEEL,0,0,$Delta,[UIntPtr]::Zero)
  }
  "type_text" {
    Assert-GuiForeground
    if ([string]::IsNullOrEmpty($Text)) { throw "Text is required" }
    $escaped = $Text.Replace("{","{{}").Replace("}","{}}").Replace("+","{+}").Replace("^","{^}").Replace("%","{%}").Replace("~","{~}")
    Send-KeysSafe $escaped
  }
  "key_press" {
    Assert-GuiForeground
    if ([string]::IsNullOrWhiteSpace($Keys)) { throw "Keys is required" }
    Send-KeysSafe $Keys
  }
  "hotkey" {
    Assert-GuiForeground
    if ([string]::IsNullOrWhiteSpace($Keys)) { throw "Keys is required" }
    Send-KeysSafe $Keys
  }
  default { throw "Unsupported GUI operation: $Operation" }
}

$state = Get-GuiState
[pscustomobject]@{ ok=$true; operation=$Operation; state=$state } | ConvertTo-Json -Compress -Depth 5
} finally {
  if ($guiInputHeld) { [void]$guiInputLock.ReleaseMutex() }
  if ($null -ne $guiInputLock) { $guiInputLock.Dispose() }
}
