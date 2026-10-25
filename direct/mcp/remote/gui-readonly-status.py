"""Read-only Windows GUI state; no input, focus or cursor mutation."""
import ctypes
import json
from ctypes import wintypes
import sys
sys.stdout.reconfigure(encoding="utf-8")

user32 = ctypes.WinDLL("user32", use_last_error=True)
class POINT(ctypes.Structure):
    _fields_ = [("x", wintypes.LONG), ("y", wintypes.LONG)]
user32.GetCursorPos.argtypes = [ctypes.POINTER(POINT)]
user32.GetCursorPos.restype = wintypes.BOOL
user32.GetForegroundWindow.restype = wintypes.HWND
user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.GetWindowTextW.restype = ctypes.c_int
p = POINT()
if not user32.GetCursorPos(ctypes.byref(p)):
    raise OSError(ctypes.get_last_error(), "GetCursorPos failed")
hwnd = user32.GetForegroundWindow()
buf = ctypes.create_unicode_buffer(1024)
user32.GetWindowTextW(hwnd, buf, 1024)
result = {"state":{"cursor":{"x":p.x,"y":p.y},"foreground_title":buf.value,"foreground_handle":int(hwnd or 0)}}
print(json.dumps(result,ensure_ascii=False,separators=(",",":")))
