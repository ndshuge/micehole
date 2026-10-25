#!/usr/bin/env python3
"""Read-only Windows GUI safety probe; fail-closed on detection errors.

Foreground automation is explicitly opt-in. Games are blocked by process name
even if currently minimized, and fullscreen foreground windows are blocked.
No focus, keyboard, mouse or window state is changed by this script.
"""
import ctypes
import csv
import io
import json
import subprocess
from ctypes import wintypes

GAME_IMAGES = {
    "cs2.exe", "csgo.exe", "dota2.exe", "valorant-win64-shipping.exe",
    "eldenring.exe", "r5apex.exe", "overwatch.exe", "overwatch2.exe",
    "fortniteclient-win64-shipping.exe", "cod.exe", "cod22-cod.exe",
    "helldivers2.exe", "cyberpunk2077.exe", "gta5.exe", "gta5_enhanced.exe",
    "league of legends.exe", "eu4.exe", "hoi4.exe", "bg3.exe",
    "f1_25.exe", "forzahorizon5.exe", "blackmythwukong.exe",
    "efootball.exe", "pes2021.exe", "rocketleague.exe",
}

class LASTINPUTINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]

class RECT(ctypes.Structure):
    _fields_ = [("left", wintypes.LONG), ("top", wintypes.LONG),
                ("right", wintypes.LONG), ("bottom", wintypes.LONG)]

class MONITORINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD), ("monitor", RECT),
                ("work", RECT), ("flags", wintypes.DWORD)]

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
user32.GetLastInputInfo.argtypes = [ctypes.POINTER(LASTINPUTINFO)]
user32.GetLastInputInfo.restype = wintypes.BOOL
kernel32.GetTickCount.restype = wintypes.DWORD
user32.GetForegroundWindow.restype = wintypes.HWND
user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(RECT)]
user32.GetWindowRect.restype = wintypes.BOOL
user32.MonitorFromWindow.argtypes = [wintypes.HWND, wintypes.DWORD]
user32.MonitorFromWindow.restype = wintypes.HANDLE
user32.GetMonitorInfoW.argtypes = [wintypes.HANDLE, ctypes.POINTER(MONITORINFO)]
user32.GetMonitorInfoW.restype = wintypes.BOOL

info = LASTINPUTINFO()
info.cbSize = ctypes.sizeof(LASTINPUTINFO)
if not user32.GetLastInputInfo(ctypes.byref(info)):
    raise OSError(ctypes.get_last_error(), "Windows idle probe failed")
idle_ms = (int(kernel32.GetTickCount()) - int(info.dwTime)) & 0xFFFFFFFF

# Check all running common games so minimizing a running game doesn't
# accidentally re-enable foreground popups. Steam alone is not a game.
result = subprocess.run(["tasklist.exe", "/fo", "csv", "/nh"],
                        capture_output=True, timeout=3, check=True)
names = set()
for row in csv.reader(io.StringIO(result.stdout.decode("utf-8", "replace"))):
    if row:
        names.add(row[0].strip().lower().replace("\ufeff", ""))
game_running = bool(GAME_IMAGES.intersection(names))

# Borderless fullscreen can resemble an ordinary window; use monitor bounds.
hwnd = user32.GetForegroundWindow()
if not hwnd:
    raise RuntimeError("Foreground window unavailable")
window = RECT()
if not user32.GetWindowRect(hwnd, ctypes.byref(window)):
    raise OSError(ctypes.get_last_error(), "Foreground window bounds unavailable")
monitor_handle = user32.MonitorFromWindow(hwnd, 2)
if not monitor_handle:
    raise RuntimeError("Monitor unavailable")
monitor_info = MONITORINFO()
monitor_info.cbSize = ctypes.sizeof(MONITORINFO)
if not user32.GetMonitorInfoW(monitor_handle, ctypes.byref(monitor_info)):
    raise OSError(ctypes.get_last_error(), "Monitor bounds unavailable")
screen = monitor_info.monitor
tolerance = 3
fullscreen = (window.right - window.left >= screen.right - screen.left - tolerance
              and window.bottom - window.top >= screen.bottom - screen.top - tolerance
              and abs(window.left - screen.left) <= tolerance
              and abs(window.top - screen.top) <= tolerance)

# Don't output window titles, PIDs or private desktop content.
print(json.dumps({
    "idle_ms": idle_ms,
    "game_running": game_running,
    "fullscreen_foreground": bool(fullscreen),
    "block_foreground": game_running or bool(fullscreen),
}, separators=(",", ":")))
