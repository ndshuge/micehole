import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const DEFAULT_CONFIG = path.join(os.homedir(), "AppData", "Local", "MiceHole", "config.json");
const DENY_PARTS = /^(?:\.env(?:\..*)?|\.ssh|\.aws|\.azure|\.gnupg|secrets?|credentials?|id_rsa|id_ed25519|authorized_keys|token(?:s)?|private[-_]?keys?)$/i;
const SKIP = new Set(["node_modules", ".git", ".venv", "venv", "__pycache__", "dist", "build"]);
const MAX_TEXT = 1024 * 1024;
const MAX_REPLY = 18000;
const jobs = new Map();
let nextJob = 1;

function fail(message) { throw new Error(message); }
function trimmed(s, limit = MAX_REPLY) { return String(s ?? "").slice(0, limit); }
function reply(operation, data) { return { ok:true, operation, ...data }; }

export function loadConfig() {
  const configPath = path.resolve(process.env.MICEHOLE_CONFIG || DEFAULT_CONFIG);
  if (!fs.existsSync(configPath)) fail("Missing configuration: " + configPath + ". Run setup-config.ps1 first.");
  const cfg = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
  if (!cfg.workspace || typeof cfg.workspace !== "string") fail("Set workspace in config.json");
  const root = fs.realpathSync.native(path.resolve(cfg.workspace));
  if (!fs.statSync(root).isDirectory()) fail("Configured workspace is not a directory");
  return { root, executionEnabled:cfg.executionEnabled === true, configPath };
}
function contained(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel));
}
function safePath(cfg, input, mayCreate = false) {
  if (typeof input !== "string" || !input.trim() || input.includes("\0")) fail("A valid path is required");
  const full = path.resolve(cfg.root, input);
  if (!contained(cfg.root, full)) fail("Path outside configured workspace");
  const rel = path.relative(cfg.root, full);
  const pieces = rel ? rel.split(path.sep) : [];
  if (pieces.some(x => DENY_PARTS.test(x))) fail("Credential-like path blocked");
  let cursor = cfg.root;
  for (const part of pieces) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) fail("Symlink path blocked");
  }
  if (!mayCreate && !fs.existsSync(full)) fail("Path not found: " + rel);
  if (fs.existsSync(full)) {
    const real = fs.realpathSync.native(full);
    if (!contained(cfg.root, real)) fail("Resolved path outside workspace");
  }
  return full;
}
function relative(cfg, file) { return path.relative(cfg.root, file).split(path.sep).join("/"); }
function executeAllowed(cfg) {
  if (!cfg.executionEnabled) fail("Shell execution disabled. Explicitly set executionEnabled=true in MiceHole config after reviewing SECURITY.md");
}
function safeCommand(cmd) {
  if (typeof cmd !== "string" || !cmd.trim() || cmd.length > 4000) fail("Command missing or too long");
  // Deny obvious direct system mutations; this is defense in depth, NOT a shell sandbox.
  if (/(?:^|[;&|]\s*)(?:format(?:\.com)?|diskpart|clear-disk|reg(?:\.exe)?\s+(?:add|delete)|schtasks(?:\.exe)?\s+\/(?:create|delete)|shutdown(?:\.exe)?)\b/i.test(cmd)) fail("Sensitive system command blocked");
  return cmd;
}
function childCommand(cmd, cwd, timeout = 30000) {
  return new Promise((resolve) => {
    const sub = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", cmd], {cwd,windowsHide:true, stdio:["ignore","pipe","pipe"]});
    let output = ""; let terminal = false; let killed = false;
    const kill = setTimeout(() => { killed=true; sub.kill(); }, Math.max(1000,Math.min(timeout,120000)));
    for (const stream of [sub.stdout,sub.stderr]) stream.on("data", b => { output = (output + b.toString("utf8")).slice(-50000); });
    sub.on("error", err => { if (terminal) return; terminal=true; clearTimeout(kill); resolve({exit_code:-1, output:trimmed(output + "\n" + err.message), timed_out:killed}); });
    sub.on("close", code => { if (terminal) return; terminal=true; clearTimeout(kill); resolve({exit_code:code ?? -1,output:trimmed(output),timed_out:killed}); });
  });
}
function listSearch(cfg, args) {
  const folder=safePath(cfg,args.path || ".",false);
  if(!fs.statSync(folder).isDirectory()) fail("Search path must be a directory");
  const mode=args.search_type || "content", pattern=String(args.pattern||"");
  if(!pattern) fail("pattern required");
  const results=[]; const stack=[folder]; let scanned=0; const limit=Math.min(100,Math.max(1,Number(args.limit)||30));
  while(stack.length && scanned<5000 && results.length<limit) {
    const dir=stack.pop();
    for(const ent of fs.readdirSync(dir,{withFileTypes:true})) {
      if(results.length>=limit || scanned>=5000) break;
      scanned++;
      if(SKIP.has(ent.name) || DENY_PARTS.test(ent.name) || ent.isSymbolicLink()) continue;
      const file=path.join(dir,ent.name);
      if(ent.isDirectory()){stack.push(file);continue;}
      if(!ent.isFile())continue;
      const rel=relative(cfg,file);
      if(mode==="files"){if(rel.toLowerCase().includes(pattern.toLowerCase())) results.push(rel); continue;}
      if(fs.statSync(file).size>250000)continue;
      let lines;try{lines=fs.readFileSync(file,"utf8").split(/\r?\n/)}catch{continue;}
      for(let i=0;i<lines.length && results.length<limit;i++){
        if(lines[i].toLowerCase().includes(pattern.toLowerCase()))results.push(rel+":"+(i+1)+": "+trimmed(lines[i],250));
      }
    }
  }
  return reply("search",{results,scanned,truncated:scanned>=5000||results.length>=limit});
}
function getJob(id) {const job=jobs.get(Number(id));if(!job)fail("Unknown process ID (processes do not persist across server restarts)");return job;}
function describeJob(job) {return {process_id:job.id,pid:job.proc.pid,running:job.running,exit_code:job.exit_code ?? null};}
function startJob(cfg,args) {
  executeAllowed(cfg);
  if(jobs.size>=40)fail("Process limit reached");
  const cwd=safePath(cfg,args.cwd||".");
  if(!fs.statSync(cwd).isDirectory())fail("cwd must be a directory");
  const command=safeCommand(args.command);
  const proc=spawn("powershell.exe",["-NoProfile","-NonInteractive","-Command",command],{cwd,windowsHide:true,stdio:["ignore","pipe","pipe"]});
  const job={id:nextJob++,proc,running:true,exit_code:null,output:"",started:Date.now()};
  jobs.set(job.id,job);
  for(const stream of [proc.stdout,proc.stderr])stream.on("data",b=>{job.output=(job.output+b.toString("utf8")).slice(-60000)});
  proc.on("close",code=>{job.running=false;job.exit_code=code ?? -1});
  proc.on("error",err=>{job.output+=String(err.message);job.running=false;job.exit_code=-1});
  const budget=Math.min(3600000,Math.max(1000,Number(args.timeout_ms)||180000));
  job.timer=setTimeout(()=>{if(job.running){job.output+="\n[terminated: configured timeout]";job.proc.kill()}},budget);
  proc.on("close",()=>clearTimeout(job.timer));
  return reply("process.start",describeJob(job));
}
function waitJob(job,ms=30000){
  return new Promise(resolve=>{
    if(!job.running) return resolve();
    const timer=setTimeout(()=>{job.proc.removeListener("close",end);job.proc.removeListener("error",end);resolve()},Math.min(30000,Math.max(0,ms)));
    function end(){clearTimeout(timer);resolve()}
    job.proc.once("close",end);job.proc.once("error",end);
  });
}
function writeAtomic(file,content){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=file+".micehole-"+randomUUID()+".tmp";
  try{fs.writeFileSync(temp,content,"utf8");fs.renameSync(temp,file)}
  finally{if(fs.existsSync(temp))fs.unlinkSync(temp)}
}
export async function dispatch(name,args={}){
  const cfg=loadConfig();
  if(name==="mouse_hole_status") return reply("status",{ready:true,edition:"Universal Preview",version:"0.1.0",workspace:cfg.root,execution_enabled:cfg.executionEnabled,tools:9});
  if(name==="mouse_hole_read"){
    const file=safePath(cfg,args.path);
    if(!fs.statSync(file).isFile())fail("Not a file");
    if(fs.statSync(file).size>MAX_TEXT)fail("File exceeds 1 MiB limit");
    const body=fs.readFileSync(file,"utf8");
    return reply("read",{path:relative(cfg,file),content:body.slice(Math.max(0,Number(args.offset)||0),Math.max(0,Number(args.offset)||0)+Math.min(MAX_REPLY,Math.max(1,Number(args.length)||MAX_REPLY))),length:body.length});
  }
  if(name==="mouse_hole_write"){
    const file=safePath(cfg,args.path,true);
    if(typeof args.content!=="string"||Buffer.byteLength(args.content)>MAX_TEXT)fail("Content must be text no more than 1 MiB");
    writeAtomic(file,args.content);return reply("write",{path:relative(cfg,file),bytes:Buffer.byteLength(args.content)});
  }
  if(name==="mouse_hole_patch"){
    const file=safePath(cfg,args.path);
    const input=fs.readFileSync(file,"utf8"),old=String(args.old_string||""),replacement=String(args.new_string??"");
    if(!old)fail("old_string required");
    const found=input.split(old).length-1;
    if(found!==(Number(args.expected_replacements)||1))fail("Patch ambiguity; matches="+found);
    const patched=input.replaceAll(old,replacement);
    if(Buffer.byteLength(patched)>MAX_TEXT)fail("File exceeds limit");
    writeAtomic(file,patched);
    return reply("patch",{path:relative(cfg,file),replacements:found});
  }
  if(name==="mouse_hole_search")return listSearch(cfg,args);
  if(name==="mouse_hole_run"||name==="mouse_hole_validate"){
    executeAllowed(cfg);const cwd=safePath(cfg,args.cwd||".");
    const data=await childCommand(safeCommand(args.command),cwd,Number(args.timeout_ms)||30000);
    return {ok:data.exit_code===0,operation:name.endsWith("validate")?"validate":"run",...data};
  }
  if(name==="mouse_hole_git"){
    const cwd=safePath(cfg,args.cwd||".");
    const a=args.operation==="diff"?["-C",cwd,"diff","--stat"]:["-C",cwd,"status","--short"];
    const data=await new Promise(resolve=>{
      const sub=spawn("git",a,{cwd,windowsHide:true});
      let out="";sub.stdout.on("data",b=>{out=(out+b.toString()).slice(-MAX_REPLY)});
      sub.stderr.on("data",b=>{out=(out+b.toString()).slice(-MAX_REPLY)});
      sub.on("close",code=>resolve({exit_code:code??-1,output:out}));
      sub.on("error",err=>resolve({exit_code:-1,output:err.message}));
    });
    return {ok:data.exit_code===0,operation:"git",...data};
  }
  if(name==="mouse_hole_process"){
    if(args.operation==="start")return startJob(cfg,args);
    const job=getJob(args.process_id);
    if(args.operation==="wait")await waitJob(job,Number(args.wait_ms)||30000);
    if(args.operation==="stop"){if(job.running)job.proc.kill();}
    if(!["status","output","wait","stop"].includes(args.operation)) fail("Unknown process operation");
    const data=describeJob(job);
    if(["output","wait"].includes(args.operation))data.output=trimmed(job.output.slice(Math.max(0,Number(args.offset)||0)),MAX_REPLY);
    return reply("process."+args.operation,data);
  }
  fail("Unknown tool: "+name);
}
