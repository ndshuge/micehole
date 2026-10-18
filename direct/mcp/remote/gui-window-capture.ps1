param(
  [Parameter(Mandatory=$true)][string]$Title,
  [Parameter(Mandatory=$true)][string]$Output
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MouseHoleWindowCapture {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
  [DllImport("user32.dll",EntryPoint="FindWindowW",CharSet=CharSet.Unicode,ExactSpelling=true)] public static extern IntPtr FindWindow(IntPtr cls,string title);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd,out RECT rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd,IntPtr hdc,uint flags);
}
'@
$hwnd=[MouseHoleWindowCapture]::FindWindow([IntPtr]::Zero,$Title)
if ($hwnd -eq [IntPtr]::Zero) { throw "Exact window not found" }
if (-not [MouseHoleWindowCapture]::IsWindowVisible($hwnd)) { throw "Target window is hidden" }
if ([MouseHoleWindowCapture]::IsIconic($hwnd)) { throw "Target window is minimized; background frame unavailable" }
$rect=New-Object MouseHoleWindowCapture+RECT
if (-not [MouseHoleWindowCapture]::GetWindowRect($hwnd,[ref]$rect)) { throw "Cannot measure window" }
$w=$rect.Right-$rect.Left; $h=$rect.Bottom-$rect.Top
if ($w -lt 80 -or $h -lt 60 -or $w -gt 3840 -or $h -gt 2160) { throw "Window capture size outside safe bounds" }
$bmp=[Drawing.Bitmap]::new($w,$h)
$g=[Drawing.Graphics]::FromImage($bmp)
try {
  $hdc=$g.GetHdc()
  try { $ok=[MouseHoleWindowCapture]::PrintWindow($hwnd,$hdc,2) }
  finally { $g.ReleaseHdc($hdc) }
  if (-not $ok) { throw "PrintWindow unsupported for this app" }
  # A technically successful Win32 call can still contain a black/blank/stale frame.
  $samples=[Collections.Generic.HashSet[int]]::new()
  for($i=0;$i -lt 16;$i++){
    for($j=0;$j -lt 16;$j++){
      $x=[int][Math]::Floor(($w-1)*($i+0.5)/16)
      $y=[int][Math]::Floor(($h-1)*($j+0.5)/16)
      [void]$samples.Add($bmp.GetPixel($x,$y).ToArgb())
    }
  }
  if ($samples.Count -lt 3) { throw "Background screenshot is blank or low-information; verify app rendering" }
  $bmp.Save($Output,[Drawing.Imaging.ImageFormat]::Png)
  @{ok=$true; path=$Output; width=$w; height=$h; sampled_colors=$samples.Count} | ConvertTo-Json -Compress
} finally {
  $g.Dispose()
  $bmp.Dispose()
}
