"""Native Windows button invocation for Mouse Hole (no cursor movement or foreground takeover).

Activated only when mouse_hole_gui(operation="click", title=EXACT_WINDOW_TITLE,
text=EXACT_NATIVE_BUTTON_CAPTION, foreground_control=true).
Fails closed on missing/duplicate/disabled/foreign controls, without touching the cursor.
BM_CLICK may not be supported by custom-drawn controls; that limitation is intentional.
"""
import argparse, ctypes, json, sys, time
from ctypes import wintypes

UI=ctypes.windll.user32
EnumProc=ctypes.WINFUNCTYPE(wintypes.BOOL,wintypes.HWND,wintypes.LPARAM)
UI.FindWindowW.argtypes=[wintypes.LPCWSTR,wintypes.LPCWSTR]
UI.FindWindowW.restype=wintypes.HWND
UI.EnumChildWindows.argtypes=[wintypes.HWND,EnumProc,wintypes.LPARAM]
UI.EnumChildWindows.restype=wintypes.BOOL
UI.GetWindowTextW.argtypes=[wintypes.HWND,wintypes.LPWSTR,ctypes.c_int]
UI.GetWindowTextW.restype=ctypes.c_int
UI.GetClassNameW.argtypes=[wintypes.HWND,wintypes.LPWSTR,ctypes.c_int]
UI.GetClassNameW.restype=ctypes.c_int
UI.GetAncestor.argtypes=[wintypes.HWND,wintypes.UINT]
UI.GetAncestor.restype=wintypes.HWND
UI.IsWindowVisible.argtypes=[wintypes.HWND]
UI.IsWindowEnabled.argtypes=[wintypes.HWND]
UI.GetForegroundWindow.restype=wintypes.HWND
UI.SendMessageTimeoutW.argtypes=[wintypes.HWND,wintypes.UINT,wintypes.WPARAM,wintypes.LPARAM,wintypes.UINT,wintypes.UINT,ctypes.POINTER(ctypes.c_size_t)]
UI.SendMessageTimeoutW.restype=wintypes.LPARAM
class POINT(ctypes.Structure):
    _fields_=[("x",wintypes.LONG),("y",wintypes.LONG)]
UI.GetCursorPos.argtypes=[ctypes.POINTER(POINT)]

def get_text(hwnd):
    buf=ctypes.create_unicode_buffer(512)
    UI.GetWindowTextW(hwnd,buf,len(buf))
    return buf.value

def get_class(hwnd):
    buf=ctypes.create_unicode_buffer(256)
    UI.GetClassNameW(hwnd,buf,len(buf))
    return buf.value

def native_button(title,caption,actuate=True):
    if not title or not caption or len(title)>512 or len(caption)>512:
        raise ValueError("Exact window title and button caption required")
    parent=UI.FindWindowW(None,title)
    if not parent or not UI.IsWindowVisible(parent):
        raise RuntimeError("Exact parent window missing or hidden")
    matches=[]
    @EnumProc
    def callback(hwnd,unused):
        klass=get_class(hwnd)
        if (get_text(hwnd)==caption and (klass.lower()=="button" or klass.lower().startswith("windowsforms10.button."))
            and UI.GetAncestor(hwnd,2)==parent):
            matches.append(int(hwnd))
        return True
    UI.EnumChildWindows(parent,callback,0)
    if len(matches)!=1:
        raise RuntimeError("Exactly one native Button required; found "+str(len(matches)))
    hwnd=matches[0]
    if not UI.IsWindowVisible(hwnd) or not UI.IsWindowEnabled(hwnd):
        raise RuntimeError("Target control is not visible/enabled")
    first=POINT();UI.GetCursorPos(ctypes.byref(first))
    started=time.perf_counter()
    if actuate:
        result=ctypes.c_size_t()
        sent=UI.SendMessageTimeoutW(hwnd,0x00F5,0,0,2,1500,ctypes.byref(result))
        if not sent: raise RuntimeError("BM_CLICK timed out; action not confirmed")
    second=POINT();UI.GetCursorPos(ctypes.byref(second))
    if (first.x,first.y)!=(second.x,second.y):
        raise RuntimeError("Physical mouse changed during semantic action")
    return {"ok":True,"operation":"click","semantic_backend":"native_button_BM_CLICK",
            "control_handle":hwnd,"parent_handle":int(parent),"target_foreground":bool(UI.GetForegroundWindow()==parent),
            "action_ms":round((time.perf_counter()-started)*1000,3),"cursor_unchanged":True,
            "message_delivered":bool(actuate)}

if __name__=="__main__":
    args=argparse.ArgumentParser()
    args.add_argument("--title",required=True)
    args.add_argument("--text",required=True)
    args.add_argument("--inspect-only",action="store_true")
    p=args.parse_args()
    try: print(json.dumps(native_button(p.title,p.text,not p.inspect_only)),flush=True)
    except Exception as exc:
        print(str(exc),file=sys.stderr,flush=True)
        sys.exit(2)
