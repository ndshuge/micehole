import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import {randomBytes,randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {requestFixture, validateFixtureRequest} from "../../src/worker/fixture-ipc.mjs";

const socket = process.platform === "win32" ?
  "\\\\.\\pipe\\micehole-qa-"+randomUUID() :
  path.join(os.tmpdir(),"micehole-qa-"+randomUUID()+".sock");
const token = randomBytes(32).toString("hex");
const host=path.resolve("scripts/tests/worker-fixture-host.mjs");
const env={
  PATH:process.env.PATH||"", Path:process.env.Path||"",
  SystemRoot:process.env.SystemRoot||"", WINDIR:process.env.WINDIR||"",
  TEMP:os.tmpdir(), TMP:os.tmpdir(),
  MICEHOLE_FIXTURE_ONLY:"1",MICEHOLE_FIXTURE_PIPE:socket,MICEHOLE_FIXTURE_TOKEN:token,
};
// Deliberately poison parent only; no authentic secrets ever enter fixture child.
process.env.MICEHOLE_RUNTIME_KEY="PARENT_ONLY_SENTINEL_NOT_REAL";
process.env.CONTROL_PLANE_API_KEY="PARENT_ONLY_SENTINEL_NOT_REAL";
const child=spawn(process.execPath,[host],{env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
let output="",error="";
child.stdout.on("data",chunk=>{output+=chunk.toString()});
child.stderr.on("data",chunk=>{error+=chunk.toString()});
async function waitReady(){
  const limit=Date.now()+7000;
  while(Date.now()<limit){
    if(output.includes("MICEHOLE_FIXTURE_READY"))return;
    if(child.exitCode!==null)throw Error("Fixture quit: "+error);
    await new Promise(resolve=>setTimeout(resolve,70));
  }
  throw Error("Fixture not ready: "+output+" "+error);
}
const checks=[];
try{
  await waitReady();
  const status=await requestFixture({pipe:socket,token,request:{kind:"request",id:1,op:"status"}});
  assert.equal(status.ok,true);
  assert.equal(status.fixture_only,true);
  assert.equal(status.remote_exec_enabled,false);
  assert.equal(status.separate_windows_sid_verified,false);
  assert.equal(status.ipc_peer_sid_authenticated,false);
  assert.deepEqual(status.inherited_sensitive_keys,[]);
  checks.push("independent process uses explicitly sanitized mock environment");

  const echo=await requestFixture({pipe:socket,token,request:{kind:"request",id:2,op:"echo",text:"safe transport"}});
  assert.equal(echo.text,"safe transport");
  checks.push("local named-pipe request/response works");

  for(const op of ["execute","git","process","validate"]){
    const attempt=await requestFixture({pipe:socket,token,
      request:{kind:"request",id:3,op,attestation:{
        claimed_sid:"S-1-5-21-FAKE-WORKER",os_verified:true,
        tunnel_key_denied:true,allow_execution:true
      },text:"echo SHOULD_NEVER_RUN"}});
    assert.equal(attempt.ok,false);
    assert.equal(attempt.error,"WORKER_NOT_OS_ISOLATED");
  }
  checks.push("forged caller-supplied identity and permissions cannot enable shell/process/Git");

  await assert.rejects(requestFixture({pipe:socket,token:"wrong",
    request:{kind:"request",id:4,op:"status"}}),/AUTH_FAILED/);
  checks.push("wrong authentication token rejected");

  const invalid=await requestFixture({pipe:socket,token,
    request:{kind:"request",id:5,op:"echo",text:"x".repeat(600)}});
  assert.equal(invalid.kind,"error");
  checks.push("request size/schema constraints enforced");

  const unknown=await requestFixture({pipe:socket,token,
    request:{kind:"request",id:6,op:"not-allowed"}});
  assert.equal(unknown.kind,"error");

  assert.throws(()=>validateFixtureRequest({kind:"request",id:1,op:"status",__proto_pollution:"bad"}));
  checks.push("unexpected message fields and unknown operations rejected");

  console.log(JSON.stringify({ok:true,checks,warning:"Same Windows SID and fixture token do not prove OS credential isolation; remote execution remains locked."},null,2));
}catch(e){
  console.error(JSON.stringify({ok:false,error:String(e),stderr:error.slice(0,1200),stdout:output.slice(0,1200)}));
  process.exitCode=1;
}finally{
  child.kill();
  if(process.platform!=="win32")try{fs.unlinkSync(socket)}catch{}
  delete process.env.MICEHOLE_RUNTIME_KEY;
  delete process.env.CONTROL_PLANE_API_KEY;
}
