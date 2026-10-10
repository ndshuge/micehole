// Offline, packaged security-gate test for the personal Tunnel entry point.
// Requires no real Tunnel credentials and does not open any network listener.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
const root=process.argv[2];
if(!root)throw Error("Pass the unpacked MiceHole distribution path");
const launcher=path.join(root,"micehole-remote.cmd");
assert.ok(fs.existsSync(launcher),"The distribution must include the protected remote launcher");
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"micehole-remote-guard-"));
const workspace=path.join(temp,"workspace");
fs.mkdirSync(workspace);
const config=path.join(temp,"user-config.json");
// DELIBERATELY enable shell in the user's regular config to test hard remote override.
fs.writeFileSync(config,JSON.stringify({workspace,executionEnabled:true}));
const env={...process.env,MICEHOLE_CONFIG:config,MICEHOLE_REMOTE_SESSION:"0",
  CONTROL_PLANE_API_KEY:"FAKE_TEST_CREDENTIAL_ONLY",OPENAI_API_KEY:"FAKE_TEST_CREDENTIAL_ONLY"};
const child=spawn("cmd.exe",["/d","/c",launcher],{env,windowsHide:true,stdio:["pipe","pipe","pipe"]});
let incoming="";let counter=0;const waiting=new Map();let stderr="";
child.stderr.on("data",data=>{stderr+=data.toString().slice(0,1500)});
child.stdout.on("data",data=>{
  incoming+=data.toString();
  for(let pos;(pos=incoming.indexOf("\n"))!==-1;){
    const str=incoming.slice(0,pos);incoming=incoming.slice(pos+1);
    if(!str.trim())continue;
    const msg=JSON.parse(str);
    const wait=waiting.get(msg.id);
    if(wait){clearTimeout(wait.timer);waiting.delete(msg.id);wait.resolve(msg)}
  }
});
function rpc(method,params={}){
  const id=++counter;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{waiting.delete(id);reject(Error("RPC timeout "+method+" "+stderr))},9000);
    waiting.set(id,{resolve,reject,timer});
    child.stdin.write(JSON.stringify({jsonrpc:"2.0",id,method,params})+"\n");
  });
}
async function call(name,args={}){
  const r=await rpc("tools/call",{name,arguments:args});
  if(r.error)return {error:r.error.message};
  const v=r.result;
  return {isError:v.isError,value:JSON.parse(v.content[0].text)};
}
try{
  const hi=await rpc("initialize",{protocolVersion:"2025-06-18",clientInfo:{name:"remote-safety-test",version:"1"},capabilities:{}});
  assert.equal(hi.result.serverInfo.name,"micehole-universal");
  const list=await rpc("tools/list");
  const names=list.result.tools.map(t=>t.name).sort();
  assert.deepEqual(names,["mouse_hole_patch","mouse_hole_read","mouse_hole_search","mouse_hole_status","mouse_hole_write"]);
  const status=await call("mouse_hole_status");
  assert.equal(status.value.remote_session,true);
  assert.equal(status.value.execution_enabled,false,"Remote mode must override enabled shell in local config");
  assert.equal(status.value.tools,5);
  const wrote=await call("mouse_hole_write",{path:"remote-test.txt",content:"EDIT_ALLOWED"});
  assert.equal(wrote.isError,false);
  const read=await call("mouse_hole_read",{path:"remote-test.txt"});
  assert.equal(read.value.content,"EDIT_ALLOWED");
  for(const name of ["mouse_hole_run","mouse_hole_validate","mouse_hole_git","mouse_hole_process"]){
    const refused=await call(name,name==="mouse_hole_process"?{operation:"start",command:"echo X"}:{command:"echo X",operation:"status"});
    assert.match(refused.error,/Unknown tool/,"Protected remote mode must not advertise or accept "+name);
  }
  const hook=await call("mouse_hole_write",{path:".git\\hooks\\post-checkout",content:"FORBIDDEN"});
  assert.equal(hook.isError,true,"Remote edits must not plant Git hooks");
  const traversal=await call("mouse_hole_read",{path:"..\\user-config.json"});
  assert.equal(traversal.isError,true);
  const protectedConfig=path.join(temp,"unsafe-config.json");
  fs.writeFileSync(protectedConfig,JSON.stringify({workspace:temp,executionEnabled:false}));
  const doctor=spawnSync(path.join(root,"runtime","node.exe"),[path.join(root,"src","server.mjs"),"--doctor"],{
    env:{...env,MICEHOLE_CONFIG:protectedConfig,MICEHOLE_REMOTE_SESSION:"1"},windowsHide:true,encoding:"utf8",timeout:8000});
  assert.notEqual(doctor.status,0,"A broad remote workspace covering its own config must be rejected");
  assert.match(doctor.stderr,/overlaps MiceHole configuration/);
  console.log(JSON.stringify({pass:true,checks:[
    "personal Tunnel uses separate remote entry point",
    "only five file/status tools exposed over Tunnel",
    "remote shell disabled even when local config allows execution",
    "remote file write/read continue to work",
    "run/validate/process/git unavailable remotely",
    "traversal and broad workspace covering config rejected"
  ]},null,2));
}catch(e){
  console.error(JSON.stringify({pass:false,error:String(e),stderr:stderr.slice(0,800)},null,2));
  process.exitCode=1;
}finally{
  child.stdin.end();child.kill();
  fs.rmSync(temp,{recursive:true,force:true});
}
