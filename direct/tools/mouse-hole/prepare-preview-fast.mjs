import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {createRequire} from "node:module";
import {performance} from "node:perf_hooks";
const require=createRequire(import.meta.url);
const ROOT=path.resolve(process.env.MOUSE_HOLE_WORKSPACE||"E:\\CHATGPT");
function safe(source){
 const result=path.resolve(source);
 const relative=path.relative(ROOT,result);
 if(relative===".."||relative.startsWith(".."+path.sep)||path.isAbsolute(relative)) throw Error("Path outside workspace");
 if(result.split(path.sep).some(s=>[".ssh",".aws","secrets"].includes(s.toLowerCase())))throw Error("Sensitive path");
 return result;
}
function parse(argv){
 const a={kind:"photo",quality:85,max_width:1920};
 for(let i=0;i<argv.length;i++){
  const key=argv[i];if(!["--source","--output","--kind","--quality","--max-width"].includes(key))throw Error("Unsupported argument "+key);
  a[key.slice(2).replaceAll("-","_")]=argv[++i];
 }
 if(!a.source||!a.output||!["ui","photo"].includes(a.kind))throw Error("Require --source --output --kind ui|photo");
 a.quality=Number(a.quality);a.max_width=Number(a.max_width);
 if(!Number.isInteger(a.quality)||a.quality<80||a.quality>95)throw Error("Quality outside 80..95");
 if(!Number.isInteger(a.max_width)||a.max_width<200||a.max_width>4096)throw Error("Width outside 200..4096");
 return a;
}
const args=parse(process.argv.slice(2)),src=safe(args.source),out=safe(args.output);
if(!fs.existsSync(src)||!fs.statSync(src).isFile()||fs.statSync(src).size>100*1024*1024)throw Error("Source absent or too large");
if(fs.existsSync(out)||!fs.existsSync(path.dirname(out)))throw Error("Output exists or missing parent directory");
const srcExt=path.extname(src).toLowerCase(),outExt=path.extname(out).toLowerCase();
if(![".png",".jpg",".jpeg",".webp"].includes(srcExt))throw Error("Unsupported input format");
if(args.kind==="ui"?!(srcExt===".png"&&outExt===".png"):![".jpg",".jpeg"].includes(outExt))throw Error("Output format mismatch");
const t=performance.now();
let guard=false;
try{
 const fd=fs.openSync(out,"wx");fs.closeSync(fd);guard=true;
 let backend="native_copy";
 if(args.kind==="ui")fs.copyFileSync(src,out);
 else {
  const moduleDir=process.env.MOUSE_HOLE_SHARP_MODULE||path.join(ROOT,"work","mice-hole-deps","sharp-0.34.5","node_modules","sharp");
  let sharp;try{sharp=require(moduleDir)}catch(err){throw Error("Pinned Sharp runtime unavailable; use existing prepare-preview.py: "+err.message)}
  if(sharp.versions.sharp!=="0.34.5")throw Error("Unexpected Sharp version");
  await sharp(src,{limitInputPixels:30000000}).flatten({background:"#ffffff"})
     .resize({width:args.max_width,withoutEnlargement:true})
     .jpeg({quality:args.quality,chromaSubsampling:"4:4:4",mozjpeg:false})
     .toFile(out);
  backend="sharp_0.34.5_444";
 }
 const raw=fs.readFileSync(out);
 const info={ok:true,backend,kind:args.kind,source:src,preview:out,original_bytes:fs.statSync(src).size,
   preview_bytes:raw.length,sha256:crypto.createHash("sha256").update(raw).digest("hex"),
   execution_ms:+(performance.now()-t).toFixed(2)};
 if(args.kind==="ui"&&!fs.readFileSync(src).equals(raw))throw Error("Lossless copy mismatch");
 console.log("PREVIEW_FAST_RESULT "+JSON.stringify(info));
}catch(err){if(guard)fs.rmSync(out,{force:true});throw err}
