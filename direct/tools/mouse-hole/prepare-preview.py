"""Prepare bounded image previews without modifying original files.

python tools/mouse-hole/prepare-preview.py --source ... --output ... --kind photo|ui
photo: <=1920px, JPEG q85; ui: exact copy of PNG bytes (lossless).
No remote upload or GUI automation occurs here.
"""
import argparse,hashlib,json,os,pathlib,shutil,sys,time

ROOT=pathlib.Path(os.environ.get("MOUSE_HOLE_WORKSPACE") or str(Path.home() / "MiceHoleWorkspace")).resolve()

def safe(p):
    p=pathlib.Path(p).resolve()
    try:p.relative_to(ROOT)
    except ValueError:raise ValueError("Image must remain inside E:\\CHATGPT")
    if any(v.lower() in (".ssh",".aws","secrets") for v in p.parts):raise ValueError("Credential-like path denied")
    return p

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--source",required=True)
    ap.add_argument("--output",required=True)
    ap.add_argument("--kind",choices=["photo","ui"],required=True)
    ap.add_argument("--max-width",type=int,default=1920)
    ap.add_argument("--quality",type=int,default=85)
    x=ap.parse_args()
    src=safe(x.source);dest=safe(x.output)
    if not src.is_file() or dest.exists() or not dest.parent.is_dir() or src==dest:
        raise ValueError("Input absent or output exists/invalid")
    if src.suffix.lower() not in (".png",".jpg",".jpeg",".webp"):
        raise ValueError("Source must be an image")
    if not 200<=x.max_width<=4096 or not 60<=x.quality<=95:
        raise ValueError("Quality/width outside safe range")
    t=time.perf_counter()
    if x.kind=="ui":
        if src.suffix.lower()!=".png" or dest.suffix.lower()!=".png":
            raise ValueError("UI preview must preserve the original PNG encoding")
        shutil.copyfile(src,dest)
    else:
        if dest.suffix.lower() not in (".jpg",".jpeg"):raise ValueError("Photo preview output must be .jpg")
        import pymupdf as fitz
        pix=fitz.Pixmap(str(src))
        width,height=pix.width,pix.height
        scale=min(1.0,x.max_width/width)
        if scale < 1:
            doc=fitz.open()
            page=doc.new_page(width=width,height=height)
            page.insert_image(page.rect,filename=str(src))
            pix=page.get_pixmap(matrix=fitz.Matrix(scale,scale),alpha=False)
            doc.close()
        dest.write_bytes(pix.tobytes("jpeg",jpg_quality=x.quality))
    import pymupdf as fitz
    test=fitz.Pixmap(str(dest))
    result={"ok":True,"source":str(src),"preview":str(dest),"kind":x.kind,
            "original_bytes":src.stat().st_size,"preview_bytes":dest.stat().st_size,
            "width":test.width,"height":test.height,
            "sha256":hashlib.sha256(dest.read_bytes()).hexdigest(),
            "elapsed_ms":round((time.perf_counter()-t)*1000,2)}
    if x.kind=="ui" and hashlib.sha256(src.read_bytes()).hexdigest()!=result["sha256"]:
        raise RuntimeError("Lossless UI copy failed integrity test")
    print("IMAGE_PREVIEW_RESULT",json.dumps(result,ensure_ascii=False))
if __name__=="__main__":
    try:main()
    except Exception as e:
        print("IMAGE_PREVIEW_FAILED",str(e),file=sys.stderr)
        sys.exit(1)
