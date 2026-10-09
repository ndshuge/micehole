import {spawn} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";
const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const fixture=path.join(base,"qa-fixture");
fs.mkdirSync(fixture,{recursive:true});
const config=path.join(base,"qa-config.json");
fs.writeFileSync(config,JSON.stringify({workspace:fixture,executionEnabled:true}));
const sub=spawn(process.execPath,[path.join(base,"src","server.mjs")],{env:{...process.env,MICEHOLE_CONFIG:config},stdio:["pipe","pipe","pipe"],windowsHide:true});
let sequence=0, pending=new Map(), buffer="";
sub.stdout.on("data",data=>{
  buffer+=data.toString();
  while(buffer.includes("\n")){
    const idx=buffer.indexOf("\n"),line=buffer.slice(0,idx);buffer=buffer.slice(idx+1);
    if(!line.trim())continue;
    const json=JSON.parse(line),p=pending.get(json.id);
    if(p){pending.delete(json.id);clearTimeout(p.timer);p.resolve(json);}
  }
});
let errors="";sub.stderr.on("data",b=>errors+=b.toString());
function rpc(method,params={}){
  const id=++sequence;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(Error("RPC timeout "+method))},15000);
    pending.set(id,{resolve,reject,timer});sub.stdin.write(JSON.stringify({jsonrpc:"2.0",id,method,params})+"\n");
  });
}
async function call(name,args){const r=await rpc("tools/call",{name,arguments:args});assert.equal(r.result?.isError,false,JSON.stringify(r));return JSON.parse(r.result.content[0].text);}
async function mustFail(name,args){const r=await rpc("tools/call",{name,arguments:args});assert.equal(r.result?.isError,true,"Expected failure "+name);}
const check=[];
try{
  const init=await rpc("initialize",{protocolVersion:"2025-06-18"});assert.equal(init.result.serverInfo.name,"micehole-universal");check.push("MCP handshake");
  const list=await rpc("tools/list");assert.equal(list.result.tools.length,9);check.push("9 universal tools");
  let status=await call("mouse_hole_status",{});assert.equal(status.execution_enabled,true);check.push("ready");
  await call("mouse_hole_write",{path:"smoke.txt",content:"alpha=1\n"});
  let read=await call("mouse_hole_read",{path:"smoke.txt"});assert.ok(read.content.includes("alpha=1"));
  await call("mouse_hole_patch",{path:"smoke.txt",old_string:"alpha=1",new_string:"alpha=2"});
  read=await call("mouse_hole_read",{path:"smoke.txt"});assert.ok(read.content.includes("alpha=2"));
  const search=await call("mouse_hole_search",{pattern:"alpha=2",path:".",search_type:"content"});
  assert.ok(search.results.some(s=>s.includes("smoke.txt")));check.push("read/write/patch/search");
  const run=await call("mouse_hole_run",{command:"node -e \"console.log('RUN_OK')\""});assert.equal(run.exit_code,0);assert.ok(run.output.includes("RUN_OK"));check.push("run");
  const validate=await call("mouse_hole_validate",{command:"node -e \"process.exit(0)\""});assert.equal(validate.exit_code,0);check.push("validate");
  const job=await call("mouse_hole_process",{operation:"start",command:"node -e \"console.log('START'); setTimeout(()=>console.log('DONE'),700)\""});
  assert.equal(job.running,true);
  const waited=await call("mouse_hole_process",{operation:"wait",process_id:job.process_id,wait_ms:5000});
  assert.equal(waited.running,false);assert.equal(waited.exit_code,0);
  assert.ok(waited.output.includes("DONE"));check.push("process start/wait/output");
  await mustFail("mouse_hole_read",{path:"..\\qa-config.json"});
  await mustFail("mouse_hole_read",{path:".env"});
  await mustFail("mouse_hole_patch",{path:"smoke.txt",old_string:"nonexistent",new_string:"x"});
  check.push("path/credential/ambiguous-patch rejection");
  const gitInit=await call("mouse_hole_run",{command:"git init -q"});
  assert.equal(gitInit.exit_code,0);
  const git=await call("mouse_hole_git",{operation:"status"});assert.equal(git.exit_code,0);check.push("git");
  console.log(JSON.stringify({pass:true,checks:check,stderr:errors},null,2));
}catch(error){console.error(JSON.stringify({pass:false,completed:check,error:String(error),stderr:errors},null,2));process.exitCode=1;}
finally{sub.stdin.end();sub.kill();}
