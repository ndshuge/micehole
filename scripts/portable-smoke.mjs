// Use the *packaged* launcher, Node runtime and server; never contact the Internet.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {spawn} from "node:child_process";
const root=process.argv[2];
if(!root)throw Error("Pass expanded portable distribution directory");
const command=path.join(root,"micehole.cmd");
assert.ok(fs.existsSync(command),"micehole.cmd absent");
const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),"micehole-portable-"));
const workspace=path.join(sandbox,"workspace");
fs.mkdirSync(workspace);
const config=path.join(sandbox,"config.json");
fs.writeFileSync(config,JSON.stringify({workspace,executionEnabled:false}));
const env={...process.env,MICEHOLE_CONFIG:config,CONTROL_PLANE_API_KEY:"TEST_SECRET_NOT_REAL",OPENAI_API_KEY:"TEST_SECRET_NOT_REAL"};
const sub=spawn("cmd.exe",["/d","/c",command],{env,windowsHide:true,stdio:["pipe","pipe","pipe"]});
const requests=new Map();let count=0,buf="",stderr="";
sub.stderr.on("data",d=>{stderr+=d.toString().slice(0,1000)});
sub.stdout.on("data",chunk=>{
  buf+=chunk.toString();
  for(let pos;(pos=buf.indexOf("\n"))>=0;){
    const raw=buf.slice(0,pos);buf=buf.slice(pos+1);
    if(!raw.trim())continue;
    let data;try{data=JSON.parse(raw)}catch(err){continue}
    const pending=requests.get(data.id);
    if(pending){clearTimeout(pending.timer);requests.delete(data.id);pending.resolve(data)}
  }
});
function rpc(method,params={}){
  return new Promise((resolve,reject)=>{
    const id=++count;const timer=setTimeout(()=>{requests.delete(id);reject(Error("Timeout for "+method))},7000);
    requests.set(id,{resolve,reject,timer});
    sub.stdin.write(JSON.stringify({jsonrpc:"2.0",id,method,params})+"\n")
  })
}
async function call(name,args){
  const result=await rpc("tools/call",{name,arguments:args});
  const v=result.result;
  if(!v)throw Error(JSON.stringify(result));
  return {isError:v.isError,data:JSON.parse(v.content[0].text)}
}
try{
  const hi=await rpc("initialize",{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"portable-smoke",version:"1"}});
  assert.equal(hi.result.serverInfo.name,"micehole-universal");
  const list=await rpc("tools/list");
  assert.equal(list.result.tools.length,9);
  const status=await call("mouse_hole_status",{});
  assert.equal(status.data.execution_enabled,false);
  const execution=await call("mouse_hole_run",{command:"echo DANGEROUS"});
  assert.equal(execution.isError,true);
  const write=await call("mouse_hole_write",{path:"portable.txt",content:"HELLO_PORTABLE"});
  assert.equal(write.isError,false);
  const read=await call("mouse_hole_read",{path:"portable.txt"});
  assert.equal(read.data.content,"HELLO_PORTABLE");
  const forbidden=await call("mouse_hole_read",{path:"..\\config.json"});
  assert.equal(forbidden.isError,true);
  // Opt in for a single environment-isolation test, then stop the process.
  fs.writeFileSync(config,JSON.stringify({workspace,executionEnabled:true}));
  const cmd=await call("mouse_hole_run",{command:"if ($env:CONTROL_PLANE_API_KEY -or $env:OPENAI_API_KEY) { exit 7 } else { Write-Output 'NO_TUNNEL_SECRET' }"});
  assert.equal(cmd.data.exit_code,0,JSON.stringify(cmd));
  assert.match(cmd.data.output,/NO_TUNNEL_SECRET/);
  console.log(JSON.stringify({pass:true,checks:["packaged launcher","bundled Node","MCP handshake and tools","disabled shell default","file scope","Tunnel key not passed to MCP shell"]},null,2))
}catch(err){
  console.error(JSON.stringify({pass:false,error:String(err),stderr:stderr.slice(0,500)},null,2));
  process.exitCode=1;
}finally{
  sub.stdin.end();sub.kill();fs.rmSync(sandbox,{recursive:true,force:true});
}
