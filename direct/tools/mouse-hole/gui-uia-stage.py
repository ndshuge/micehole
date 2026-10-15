"""Opt-in, bounded Windows UIA stage using the already-installed pywinauto.

Manifest: {"window_title":"EXACT_TITLE","allow_actuation":true,
 "steps":[{"operation":"set_text","automation_id":"NAME","value":"hi"},
          {"operation":"set_checked","automation_id":"CHECK","checked":true}],
 "receipt":"E:\\CHATGPT\\work\\...\\receipt.json"}
Unlike native BM_CLICK, UIA supports Edit and CheckBox controls where available.
Actions that trigger external effects still require independent application-level verification.
"""
import argparse,json,os,pathlib,sys,time
from pywinauto import Application
ROOT=pathlib.Path(os.environ.get("MOUSE_HOLE_WORKSPACE",r"E:\CHATGPT")).resolve()
def safe(x):
    p=pathlib.Path(x).resolve()
    try:p.relative_to(ROOT)
    except ValueError:raise ValueError("File outside workspace")
    return p
def stage(obj):
    title=obj.get("window_title")
    steps=obj.get("steps")
    if not isinstance(title,str) or not 1<=len(title)<=512:raise ValueError("Exact window title required")
    if not isinstance(steps,list) or not 1<=len(steps)<=8:raise ValueError("1-8 operations required")
    if obj.get("allow_actuation") is not True:raise ValueError("allow_actuation=true required")
    conn=Application(backend="uia").connect(title=title)
    win=conn.top_window()
    if win.element_info.name!=title:raise ValueError("Window title changed")
    start=time.perf_counter()
    controls=win.descendants()
    if len(controls)>300:raise RuntimeError("Control tree too large; inspect narrower UIA scope")
    by_id={}
    for c in controls:
        id_=c.element_info.automation_id
        if id_:by_id.setdefault(id_,[]).append(c)
    results=[]
    for i,item in enumerate(steps):
        if not isinstance(item,dict):raise ValueError("Each step must be an object")
        operation=item.get("operation");id_=item.get("automation_id")
        if operation not in ("set_text","set_checked","invoke") or not isinstance(id_,str) or not 1<=len(id_)<=128:
            raise ValueError("Unsupported operation or automation ID")
        found=by_id.get(id_,[])
        if len(found)!=1:raise RuntimeError("Expected one UIA control for "+id_+", got "+str(len(found)))
        el=found[0];wrapper=el
        if not el.is_enabled():raise RuntimeError("Disabled target "+id_)
        t=time.perf_counter()
        if operation=="set_text":
            if el.element_info.control_type!="Edit":raise RuntimeError("Target is not Edit")
            value=item.get("value")
            if not isinstance(value,str) or len(value)>2000:raise ValueError("Invalid input value")
            wrapper.set_edit_text(value)
            actual=wrapper.get_value() if hasattr(wrapper,"get_value") else wrapper.window_text()
            if actual!=value:raise RuntimeError("Edit postcondition not met")
            detail={"value_matches":True}
        elif operation=="set_checked":
            if el.element_info.control_type!="CheckBox":raise RuntimeError("Target is not CheckBox")
            desired=item.get("checked")
            if type(desired) is not bool:raise ValueError("checked must be boolean")
            before=int(wrapper.get_toggle_state())
            if before!=int(desired):wrapper.toggle()
            current=int(wrapper.get_toggle_state())
            if current!=int(desired):raise RuntimeError("CheckBox postcondition not met")
            detail={"checked":bool(current)}
        else:
            if el.element_info.control_type!="Button":raise RuntimeError("Target is not Button")
            wrapper.invoke()
            detail={"invoked":True,"business_state_requires_verification":True}
        results.append({"step":i,"operation":operation,"automation_id":id_,"elapsed_ms":round((time.perf_counter()-t)*1000,2),**detail})
    return {"ok":True,"backend":"pywinauto_uia_bounded_stage","steps":results,"elapsed_ms":round((time.perf_counter()-start)*1000,2)}
def main():
    parser=argparse.ArgumentParser();parser.add_argument("--manifest",required=True);args=parser.parse_args()
    manifest=json.loads(safe(args.manifest).read_text(encoding="utf8"))
    receipt=manifest.get("receipt")
    if receipt:
        receipt=safe(receipt)
        if receipt.exists() or not receipt.parent.is_dir():raise ValueError("Receipt exists or parent directory missing")
    result=stage(manifest)
    if receipt:receipt.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf8")
    print("GUI_UIA_STAGE "+json.dumps(result,ensure_ascii=False),flush=True)
if __name__=="__main__":
    try:main()
    except Exception as exc:
        print("GUI_UIA_STAGE_FAILED "+str(exc),file=sys.stderr,flush=True);sys.exit(1)
