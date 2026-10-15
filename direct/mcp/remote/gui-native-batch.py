"""One-shot concurrent native Windows button operations, no resident service, queue or Agent.

Invoke via existing Mice Hole run/long process:
 python mcp/remote/gui-native-batch.py --manifest E:\\CHATGPT\\work\\batch.json
 Manifest:
 {"actions":[{"title":"EXACT_WINDOW_TITLE","text":"EXACT_NATIVE_BUTTON_LABEL"},...],
  "concurrency":2,"receipt":"E:\\\\CHATGPT\\\\work\\\\batch-result.json"}
Only distinct visible Win32 or WinForms native buttons. Identical window titles rejected.
The result confirms Win32 message delivery, not arbitrary application business outcome.
"""
import argparse
import concurrent.futures
import json
import os
from pathlib import Path
import sys
import time
from importlib.machinery import SourceFileLoader

ROOT=Path(os.environ.get("MOUSE_HOLE_WORKSPACE",r"E:\CHATGPT")).resolve()
def safe(file):
    p=Path(file).resolve()
    try:p.relative_to(ROOT)
    except ValueError:raise ValueError("Manifest/receipt must be inside workspace")
    if any(part.lower() in (".ssh",".aws","secrets") for part in p.parts):
        raise ValueError("Sensitive path denied")
    return p

def execute(manifest):
    if not isinstance(manifest,dict):raise ValueError("JSON object required")
    actions=manifest.get("actions")
    if not isinstance(actions,list) or not 1<=len(actions)<=8:raise ValueError("1..8 actions required")
    concurrency=manifest.get("concurrency",2)
    if not isinstance(concurrency,int) or not 1<=concurrency<=4:raise ValueError("concurrency must be 1..4")
    names=set()
    for item in actions:
        if not isinstance(item,dict) or set(item)!={"title","text"}:raise ValueError("Each action only allows title and text")
        if not all(isinstance(item[k],str) and 1<=len(item[k].strip())<=512 for k in ["title","text"]):raise ValueError("Exact names required")
        key=item["title"].strip().casefold()
        if key in names:raise ValueError("Duplicate window actions not permitted; one window is single-owner")
        names.add(key)
    receipt=safe(manifest["receipt"]) if "receipt" in manifest else None
    if receipt is not None and (receipt.exists() or not receipt.parent.is_dir()):
        raise ValueError("Receipt already exists or parent missing")
    source=Path(__file__).with_name("gui-native-button.py")
    module=SourceFileLoader("mh_gui_native_button_batch",str(source)).load_module()
    started=time.perf_counter()
    def action(item):
        t=time.perf_counter()
        try:
            result=module.native_button(item["title"],item["text"],True)
            return {"ok":True,"title":item["title"],"caption":item["text"],
                    "action_ms":result["action_ms"],"elapsed_ms":round((time.perf_counter()-t)*1000,2),
                    "cursor_unchanged":result["cursor_unchanged"],"message_delivered":result["message_delivered"]}
        except Exception as error:
            return {"ok":False,"title":item["title"],"caption":item["text"],
                    "elapsed_ms":round((time.perf_counter()-t)*1000,2),"reason":str(error)[:300]}
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool:
        results=list(pool.map(action,actions))
    report={"ok":all(x["ok"] for x in results),"operation":"gui.native_button_batch",
            "backend":"win32_bm_click_one_shot","count":len(results),"concurrency":concurrency,
            "elapsed_ms":round((time.perf_counter()-started)*1000,2),
            "windows":results}
    if receipt is not None:
        receipt.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf8")
    return report

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--manifest")
    p.add_argument("--pair",nargs=2,action="append",metavar=("EXACT_WINDOW_TITLE","BUTTON_CAPTION"))
    p.add_argument("--concurrency",type=int,default=2)
    p.add_argument("--receipt")
    opts=p.parse_args()
    try:
        if bool(opts.manifest)==bool(opts.pair):raise ValueError("Choose exactly one of --manifest or --pair")
        cfg=json.loads(safe(opts.manifest).read_text(encoding="utf8")) if opts.manifest else {"actions":[{"title":title,"text":text} for title,text in opts.pair],"concurrency":opts.concurrency,**({"receipt":opts.receipt} if opts.receipt else {})}
        result=execute(cfg)
        print("MOUSE_HOLE_GUI_BATCH "+json.dumps(result,ensure_ascii=False),flush=True)
        sys.exit(0 if result["ok"] else 2)
    except Exception as error:
        print("MOUSE_HOLE_GUI_BATCH_ERROR "+str(error),file=sys.stderr,flush=True)
        sys.exit(1)
