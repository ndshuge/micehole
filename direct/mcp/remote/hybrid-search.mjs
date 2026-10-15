import fs from "node:fs";
import path from "node:path";
import { isDeniedPath } from "./bridge-core.mjs";

// Asynchronous, bounded workspace search. Uncertain/truncated results are never "not found".
const SKIP_DIRS=new Set([".git",".godot","node_modules","__pycache__",".venv"]);
const MAX_FILES=60000, MAX_ITEMS=150000, MAX_OUTPUT=12000, MAX_FILE_BYTES=1024*1024, MAX_TIME_MS=12000;
function safeRoot(root, requested){
  const base=fs.realpathSync.native(root);
  const target=fs.realpathSync.native(path.resolve(base,requested||"."));
  const rel=path.relative(base,target);
  if(rel===".."||rel.startsWith(".."+path.sep)||path.isAbsolute(rel)||isDeniedPath(rel))
    throw new Error("Search root must remain in workspace");
  return {base,target};
}
function isUtf8Text(buffer){
  return !buffer.includes(0) && new TextDecoder("utf-8",{fatal:true}).decode(buffer).length>=0;
}
export async function nativeSearch(root,args={}){
  const {base,target}=safeRoot(root,args.path);
  const needle=String(args.pattern||"");
  if(!needle || needle.length>4000)throw Error("Search pattern must contain 1 to 4000 characters");
  const mode=args.search_type||"content";
  if(!["files","content"].includes(mode))throw Error("Unknown search mode");
  const limit=Math.max(1,Math.min(100,Number(args.limit)||50));
  const stack=[target], matches=[];let files=0,entries=0,skipped=0,skippedLarge=0,stopped=false;
  const started=Date.now();
  while(stack.length && matches.length<limit && files<MAX_FILES && entries<MAX_ITEMS && Date.now()-started<MAX_TIME_MS){
    const dir=stack.pop();
    let list;
    try{list=await fs.promises.readdir(dir,{withFileTypes:true})}catch{skipped++;continue}
    // Directory reads are bounded; per-file async I/O lets Runtime serve unrelated requests.
    for(let i=0;i<list.length;i+=12){
      if(matches.length>=limit||files>=MAX_FILES||entries>=MAX_ITEMS||Date.now()-started>=MAX_TIME_MS){stopped=true;break}
      const chunk=list.slice(i,i+12);
      const candidates=[];
      for(const entry of chunk){
        entries++;
        if(entry.isSymbolicLink())continue;
        const file=path.join(dir,entry.name);
        const rel=path.relative(base,file).replaceAll("\\","/");
        if(isDeniedPath(rel))continue;
        if(entry.isDirectory()){if(!SKIP_DIRS.has(entry.name))stack.push(file);continue}
        if(!entry.isFile())continue;
        files++;
        if(mode==="files"){
          if(entry.name.toLowerCase().includes(needle.toLowerCase()))matches.push(rel);
        }else{candidates.push({file,rel})}
      }
      if(mode==="content" && candidates.length){
        const outcomes=await Promise.all(candidates.map(async ({file,rel})=>{
          try{
            const st=await fs.promises.stat(file);
            if(st.size>MAX_FILE_BYTES)return {large:true};
            const data=await fs.promises.readFile(file);
            if(!isUtf8Text(data))return {binary:true};
            const lines=data.toString("utf8").split(/\r?\n/);
            const found=[];
            for(let n=0;n<lines.length;n++)if(lines[n].includes(needle))found.push(rel+":"+(n+1)+": "+lines[n].slice(0,300));
            return {found};
          }catch{return {skipped:true}}
        }));
        for(const outcome of outcomes){
          if(outcome.large)skippedLarge++;
          else if(outcome.skipped)skipped++;
          else if(outcome.found)for(const hit of outcome.found)if(matches.length<limit)matches.push(hit);
        }
      }
    }
  }
  const complete=!stopped && stack.length===0 && files<MAX_FILES && entries<MAX_ITEMS && matches.length<limit && skipped===0 && skippedLarge===0;
  const incomplete=!complete;
  const text=matches.join("\n");
  const result={
    ok:complete||matches.length>0,
    operation:"search",
    output:text.slice(0,MAX_OUTPUT),
    truncated:incomplete||text.length>MAX_OUTPUT,
    complete:complete&&! (text.length>MAX_OUTPUT),
    backend:"native_search",
    metadata:{files_scanned:files,entries_scanned:entries,found:matches.length,skipped,skipped_large:skippedLarge,elapsed_ms:Date.now()-started,complete},
  };
  if(incomplete && matches.length===0)Object.assign(result,{ok:false,error_class:"incomplete_search",error_detail:"Search incomplete; do not interpret zero matches as absence"});
  return result;
}
