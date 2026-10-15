/**
 * Mouse Hole bounded cross-tool stage runner. No Agent, service, worker, queue or MCP schema change.
 * Input: --payload-b64 UTF8_BASE64 or --manifest PATH (one JSON object).
 * stage groups execute in order; independent actions within a group execute concurrently.
 * Existing core adapters enforce workspace boundaries. Mutations require explicit allow_mutation=true.
 */
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { mouseHoleCoreCall } from "../../mcp/remote/mouse-hole-core.mjs";
import { closeBrowserSessions } from "../../mcp/remote/browser-cdp.mjs";
import { DEFAULT_WORKSPACE, isDeniedPath } from "../../mcp/remote/bridge-core.mjs";
const ROOT = fs.realpathSync.native(process.env.MOUSE_HOLE_WORKSPACE || DEFAULT_WORKSPACE);
const READONLY = new Set(["mouse_hole_read","mouse_hole_search","mouse_hole_git","mouse_hole_status","mouse_hole_browser"]);
const MUTATION = new Set(["mouse_hole_write","mouse_hole_patch"]);
const SUPPORTED = new Set([...READONLY,...MUTATION]);
const MAX_OPERATIONS = 12, MAX_PARALLEL = 4, MAX_ARG_BYTES = 48000;
function workspacePath(input,existing=true){
  if(typeof input!=="string"||!input||input.length>2048)throw Error("Expected a bounded workspace path");
  const resolved=path.resolve(ROOT,input);
  const relative=path.relative(ROOT,resolved);
  if(relative===".."||relative.startsWith(".."+path.sep)||path.isAbsolute(relative)||isDeniedPath(relative))throw Error("Path outside workspace or sensitive path");
  const guard = existing?resolved:fs.existsSync(resolved)?resolved:path.dirname(resolved);
  const real=fs.realpathSync.native(guard);
  const r=path.relative(ROOT,real);
  if(r===".."||r.startsWith(".."+path.sep)||path.isAbsolute(r)||isDeniedPath(r))throw Error("Symlink escapes workspace");
  return resolved;
}
function load(args){
  if(args.length!==2||!["--manifest","--payload-b64"].includes(args[0]))throw Error("Use exactly --manifest PATH or --payload-b64 BASE64");
  if(args[0]==="--manifest")return JSON.parse(fs.readFileSync(workspacePath(args[1]),"utf8"));
  if(args[1].length>Math.ceil(MAX_ARG_BYTES*4/3))throw Error("Batch payload too large");
  return JSON.parse(Buffer.from(args[1],"base64").toString("utf8"));
}
function validate(input){
  if(!input||typeof input!=="object"||Array.isArray(input))throw Error("Batch must be an object");
  const groups=input.stages;
  if(!Array.isArray(groups)||groups.length<1||groups.length>8)throw Error("stages must have 1–8 groups");
  let count=0;const records=new Set();
  const allowMutation=input.allow_mutation===true;
  for(let stage=0;stage<groups.length;stage++){
    const group=groups[stage];
    if(!Array.isArray(group)||group.length<1||group.length>MAX_PARALLEL)throw Error("Each group must have 1–4 actions");
    for(const step of group){
      count++;
      if(!step||typeof step!=="object"||Array.isArray(step)||Object.keys(step).some(k=>!["name","args","id"].includes(k)))throw Error("Unexpected action structure");
      if(!SUPPORTED.has(step.name))throw Error("Unsupported bounded batch operation");
      if(MUTATION.has(step.name)&&!allowMutation)throw Error("Mutation requires allow_mutation=true");
      if(step.id!==undefined){
        if(typeof step.id!=="string"||!/^[-_a-z0-9]{1,32}$/i.test(step.id)||records.has(step.id))throw Error("Invalid/duplicate action id");
        records.add(step.id);
      }
      const a=step.args||{};
      if(typeof a!=="object"||Array.isArray(a)||Buffer.byteLength(JSON.stringify(a))>MAX_ARG_BYTES)throw Error("Invalid action args");
      if(["mouse_hole_read","mouse_hole_write","mouse_hole_patch"].includes(step.name)){
        if(typeof a.path!=="string"||a.path.startsWith("construction://"))throw Error("Batch construction state mutation not supported");
        workspacePath(a.path,false); // May be created by an earlier stage; actual operation validates existence.
      }
      if(step.name==="mouse_hole_search" && a.path)workspacePath(a.path);
      if(step.name==="mouse_hole_browser"){
        if(!["status","inspect","dump_dom"].includes(a.operation))throw Error("Only read-only browser operations are allowed in generic batches; use the verified browser stage for actuation");
        if(a.operation!=="status" && (typeof a.url!=="string" || !/^https?:\/\//i.test(a.url)))throw Error("Browser stage requires an HTTP(S) URL");
      }
      if(step.name==="mouse_hole_git" && a.cwd)workspacePath(a.cwd);
      if(step.name==="mouse_hole_status" && (!["runtime","processes","service","port","startup","power","gpu",undefined].includes(a.detail)))throw Error("Unsupported diagnostic detail");
    }
    // Do not permit two concurrent writers/read-modifiers on one path.
    const paths=new Map();
    for(const step of group){
      const p=step.args?.path;
      if(typeof p!=="string"||!["mouse_hole_read","mouse_hole_write","mouse_hole_patch"].includes(step.name))continue;
      const key=path.resolve(ROOT,p).toLowerCase(), prior=paths.get(key);
      if(prior&&(MUTATION.has(step.name)||prior.mutates))throw Error("Conflicting concurrent file operations "+path.basename(p));
      paths.set(key,{mutates:MUTATION.has(step.name)});
    }
  }
  if(count>MAX_OPERATIONS)throw Error("Too many actions (>12)");
  if(input.receipt!==undefined){
    const p=workspacePath(input.receipt,false);
    if(fs.existsSync(p)||!fs.existsSync(path.dirname(p)))throw Error("Receipt exists or parent missing");
  }
  return {groups,allowMutation,count,receipt:input.receipt};
}
// Cooperative cross-process guard for TWO independent bounded-batch processes.
 // Existing direct individual MCP writes do not participate: this is not a global OS lock.
function acquireBatchLocks(groups){
  const paths=new Set();
  for(const group of groups)for(const step of group){
    if(MUTATION.has(step.name))paths.add(path.resolve(ROOT,step.args.path).toLowerCase());
  }
  if(paths.size===0)return ()=>{};
  const lockDir=path.join(ROOT,"work","mice-hole-p0-locks");
  fs.mkdirSync(lockDir,{recursive:true});
  const held=[];
  try{
    for(const target of [...paths].sort()){
      const name=createHash("sha256").update(target).digest("hex")+".lock";
      const lock=path.join(lockDir,name);
      let fd;
      try{
        fd=fs.openSync(lock,"wx",0o600);
        fs.writeSync(fd,JSON.stringify({pid:process.pid,target,created_at:new Date().toISOString()}));
        held.push(lock);
      }catch(e){
        if(e.code==="EEXIST")throw Error("resource_busy: file owned by another bounded batch; "+path.basename(target));
        throw e;
      }finally{if(fd!==undefined)fs.closeSync(fd)}
    }
  }catch(e){for(const x of held.reverse())fs.rmSync(x,{force:true});throw e}
  return ()=>{for(const x of held.reverse())fs.rmSync(x,{force:true})};
}
async function executeStep(step,group,index){
  const started=performance.now();
  try{
    const value=await mouseHoleCoreCall(ROOT,step.name,step.args||{});
    const ok=value?.ok===true;
    // No rich images, uncontrolled stdout, or copied huge tool results in stage receipts.
    const output=String(value?.output||"");
    return {
      group,index,id:step.id??null,name:step.name,ok,
      elapsed_ms:+(performance.now()-started).toFixed(2),
      output:output.slice(0,1800),output_chars:output.length,
      ...("complete" in (value||{})?{complete:value.complete}:{}),
      ...("truncated" in (value||{})?{truncated:value.truncated}:{}),
      ...(value?.backend?{backend:value.backend}:{}),
      ...(value?.failure?{failure:value.failure}:{}),
      ...(value?.reason?{reason:String(value.reason).slice(0,280)}:{}),
      ...(value?.error_class?{error_class:value.error_class}:{})
    };
  }catch(e){return {group,index,id:step.id??null,name:step.name,ok:false,elapsed_ms:+(performance.now()-started).toFixed(2),failure:"exception",reason:String(e.message||e).slice(0,380)}}
}
export async function runBatch(input){
  const {groups,count,receipt}=validate(input);
  const start=performance.now(),results=[];
  const release=acquireBatchLocks(groups);
  let aborted=false;
  try {
    for(let group=0;group<groups.length;group++){
      const actions=await Promise.all(groups[group].map((x,index)=>executeStep(x,group,index)));
      results.push(...actions);
      if(actions.some(x=>!x.ok)){aborted=true;break} // Search hitting its result limit remains a warning, not a false negative.
    }
  } finally { try { await closeBrowserSessions(); } finally { release(); } }
  const result={ok:!aborted&&results.length===count,operation:"bounded_cross_tool_batch",count:results.length,requested:count,groups_executed:new Set(results.map(x=>x.group)).size,
    elapsed_ms:+(performance.now()-start).toFixed(2),aborted,results};
  if(receipt)fs.writeFileSync(workspacePath(receipt,false),JSON.stringify(result,null,2),{flag:"wx"});
  return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Z]:)/i,""))){
  try{
    const input=load(process.argv.slice(2));
    const output=await runBatch(input);
    console.log("MOUSE_HOLE_BATCH "+JSON.stringify(output));
    if(!output.ok)process.exitCode=2;
  }catch(e){console.error("MOUSE_HOLE_BATCH_ERROR "+String(e.message||e));process.exitCode=1}
}
