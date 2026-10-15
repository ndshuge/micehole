/** Opt-in image preview over EXISTING mouse_hole_observe(target=image, path=...).
 * No schema change, no new MCP service. Exact originals remain untouched:
 *   preview-photo://E:\\CHATGPT\\work\\picture.png
 *   preview-ui://E:\\CHATGPT\\work\\screenshot.png
 *   preview-region://left,top,width,height|E:\\CHATGPT\\work\\screenshot.png
 * Normal paths still use the existing adapter unchanged.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { isDeniedPath } from "./bridge-core.mjs";
const require=createRequire(import.meta.url);
const TYPES=new Map([[".png","image/png"],[".jpg","image/jpeg"],[".jpeg","image/jpeg"],[".webp","image/webp"]]);
let sharpCache=null;
function inside(root,value){
  const base=fs.realpathSync.native(root);
  const target=path.resolve(base,value);
  const rel=path.relative(base,target);
  if(rel===".."||rel.startsWith(".."+path.sep)||path.isAbsolute(rel)||isDeniedPath(rel))throw Error("Image preview source outside allowed workspace");
  const real=fs.realpathSync.native(target);
  const realRel=path.relative(base,real);
  if(realRel===".."||realRel.startsWith(".."+path.sep)||path.isAbsolute(realRel)||isDeniedPath(realRel))throw Error("Image preview symlink escapes workspace");
  const stat=fs.statSync(real);
  if(!stat.isFile()||stat.size>20*1024*1024)throw Error("Image must be a file <= 20 MiB");
  if(!TYPES.has(path.extname(real).toLowerCase()))throw Error("Only PNG, JPEG or WebP preview sources accepted");
  return {real,stat};
}
function sharp(root){
  if(sharpCache)return sharpCache;
  const modulePath=process.env.MOUSE_HOLE_SHARP_MODULE || path.join(root,"work","mice-hole-deps","sharp-0.34.5","node_modules","sharp");
  const impl=require(modulePath);
  if(impl.versions.sharp!=="0.34.5")throw Error("Pinned Sharp version mismatch");
  sharpCache=impl;
  return impl;
}

/** Preview a captured desktop/window screenshot WITHOUT putting the full screenshot on MCP. */
export async function observeCapturedPreview(root,args,raw){
  const started=performance.now();
  const originalItem=raw?.__mcp_content?.find?.(item=>item.type==="image");
  if(!raw?.ok||!originalItem?.data)throw Error("Screenshot backend did not return image content");
  const original=Buffer.from(originalItem.data,"base64");
  if(original.length>20*1024*1024)throw Error("Captured screenshot exceeds media budget");
  const match=/^(preview-region|preview-photo|preview-ui):\/\/(.*)$/s.exec(args.path||"");
  if(!match)throw Error("Invalid captured preview mode");
  let mode=match[1],backend="original",buffer=original,mimeType=originalItem.mimeType||"image/png",region=null;
  const opts=match[2].trim();
  if(mode==="preview-region"){
    const xs=opts.split(",").map(Number);
    if(xs.length!==4||xs.some(x=>!Number.isInteger(x)))throw Error("Expected region x,y,w,h");
    const [left,top,width,height]=xs;
    if(left<0||top<0||width<1||height<1||width>3840||height>2160)throw Error("Invalid bounded screen region");
    const meta=await sharp(root)(original,{limitInputPixels:32000000}).metadata();
    if(left+width>meta.width||top+height>meta.height)throw Error("Screen region exceeds bounds");
    region={left,top,width,height};
    buffer=await sharp(root)(original,{limitInputPixels:32000000}).extract(region).png().toBuffer();
    mimeType="image/png";backend="sharp-lossless-region";
  }else if(mode==="preview-photo"){
    if(opts)throw Error("preview-photo screen mode takes no value");
    const next=await sharp(root)(original,{limitInputPixels:32000000}).flatten({background:"#ffffff"})
      .resize({width:1920,withoutEnlargement:true}).jpeg({quality:85,chromaSubsampling:"4:4:4"}).toBuffer();
    if(next.length<original.length){buffer=next;mimeType="image/jpeg";backend="sharp-q85-444"}
    else backend="original-smaller";
  }else if(opts)throw Error("preview-ui screen mode takes no value");
  return {ok:true,operation:"observe",path:raw.path,
    metadata:{
      media_mode:mode,backend,original_bytes:original.length,transmit_bytes:buffer.length,
      saved_bytes:Math.max(0,original.length-buffer.length),preparation_ms:+(performance.now()-started).toFixed(2),
      dimensions:region,mime_type:mimeType,original_preserved:true,
      capture_source:args.target
    },
    __mcp_content:[{type:"image",mimeType,data:buffer.toString("base64")}]
  };
}

export function isPreviewMediaPath(value){
  return typeof value==="string"&&/^(preview-photo|preview-ui|preview-region):\/\//.test(value);
}
export async function observePreview(root,args){
  if(args.target!=="image"||!isPreviewMediaPath(args.path))throw Error("Wrong image preview mode");
  const started=performance.now();
  const match=/^(preview-photo|preview-ui|preview-region):\/\/(.*)$/s.exec(args.path);
  let mode=match[1],source=match[2],rect=null;
  if(mode==="preview-region"){
    const pos=source.indexOf("|");
    if(pos<0)throw Error("Region requires x,y,w,h|SOURCE");
    const fields=source.slice(0,pos).split(",").map(Number);
    if(fields.length!==4||fields.some(v=>!Number.isInteger(v)))throw Error("Region coordinates must be integers");
    const [left,top,width,height]=fields;
    if(left<0||top<0||width<1||height<1||width>3840||height>2160)throw Error("Invalid bounded screenshot region");
    rect={left,top,width,height};source=source.slice(pos+1);
  }
  const {real,stat}=inside(root,source);
  const sourceMime=TYPES.get(path.extname(real).toLowerCase());
  let original=fs.readFileSync(real),payload=original,mimeType=sourceMime,backend="original";
  if(mode==="preview-photo" && stat.size>=350*1024){
    const out=await sharp(root)(original,{limitInputPixels:32000000})
      .flatten({background:"#ffffff"})
      .resize({width:1920,withoutEnlargement:true})
      .jpeg({quality:85,chromaSubsampling:"4:4:4"}).toBuffer();
    if(out.length<original.length){payload=out;mimeType="image/jpeg";backend="sharp-q85-444";}
    else backend="original-smaller";
  }
  if(rect){
    const info=await sharp(root)(original,{limitInputPixels:32000000}).metadata();
    if(rect.left+rect.width>info.width||rect.top+rect.height>info.height)throw Error("Region exceeds image bounds");
    payload=await sharp(root)(original,{limitInputPixels:32000000}).extract(rect).png().toBuffer();
    mimeType="image/png";backend="sharp-lossless-region";
  }
  return {
    ok:true,operation:"observe",path:real,
    metadata:{
      media_mode:mode,backend,original_bytes:original.length,transmit_bytes:payload.length,
      saved_bytes:Math.max(0,original.length-payload.length),preparation_ms:+(performance.now()-started).toFixed(2),
      dimensions:rect||null,mime_type:mimeType,
      original_preserved:true
    },
    __mcp_content:[{type:"image",mimeType,data:payload.toString("base64")}]
  };
}
