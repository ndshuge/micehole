// Isolated release security regression tests. No production configuration is read.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dispatch } from "../src/core.mjs";

const base=fs.mkdtempSync(path.join(os.tmpdir(),"micehole-sec-"));
const workspace=path.join(base,"workspace");
const outside=path.join(base,"outside");
fs.mkdirSync(workspace);fs.mkdirSync(outside);
fs.writeFileSync(path.join(outside,"canary.txt"),"CONFIDENTIAL_CANARY");
fs.writeFileSync(path.join(workspace,"ok.txt"),"HELLO");
fs.writeFileSync(path.join(workspace,".env"),"DUMMY_SECRET");
const cfg=path.join(base,"config.json");
fs.writeFileSync(cfg,JSON.stringify({workspace,executionEnabled:false}));
process.env.MICEHOLE_CONFIG=cfg;
const checks=[];
const reject=async(name,args)=>{
  await assert.rejects(async()=>dispatch(name,args),undefined,name+" must reject");
};
try {
  const s=await dispatch("mouse_hole_status");assert.equal(s.execution_enabled,false);checks.push("disabled-by-default execution");
  for(const name of ["mouse_hole_run","mouse_hole_validate"]){
    await reject(name,{command:"echo SHOULD_NOT_RUN"});
  }
  await reject("mouse_hole_process",{operation:"start",command:"echo SHOULD_NOT_RUN"});
  checks.push("all command launch paths require explicit opt-in");
  await reject("mouse_hole_read",{path:"..\\outside\\canary.txt"});
  await reject("mouse_hole_read",{path:path.join(outside,"canary.txt")});
  await reject("mouse_hole_write",{path:"..\\outside\\write.txt",content:"BAD"});
  await reject("mouse_hole_patch",{path:"..\\outside\\canary.txt",old_string:"CONFIDENTIAL",new_string:"BAD"});
  checks.push("workspace traversal blocked for read/write/patch");
  await reject("mouse_hole_read",{path:".env"});
  await reject("mouse_hole_write",{path:".ssh\\id_rsa",content:"FAKE"});
  await reject("mouse_hole_search",{path:".ssh",pattern:"secret"});
  checks.push("credential-like paths rejected");
  const allowed=await dispatch("mouse_hole_read",{path:"ok.txt"});assert.equal(allowed.content,"HELLO");
  checks.push("non-sensitive read continues to work");
  // On Windows, junctions should never allow traversal into an external directory.
  const link=path.join(workspace,"escape-link");
  let linkCreated=false;
  try {
    fs.symlinkSync(outside,link,process.platform==="win32"?"junction":"dir");
    linkCreated=true;
  }catch(ex){
    if(!["EPERM","EACCES","ENOTSUP"].includes(ex.code))throw ex;
  }
  if(linkCreated){
    await reject("mouse_hole_read",{path:"escape-link\\canary.txt"});
    await reject("mouse_hole_write",{path:"escape-link\\overwrite.txt",content:"BAD"});
    checks.push("directory link to outside rejected");
  }else checks.push("junction test skipped (OS privilege restriction)");
  assert.equal(fs.readFileSync(path.join(outside,"canary.txt"),"utf8"),"CONFIDENTIAL_CANARY");
  assert.ok(!fs.existsSync(path.join(outside,"write.txt")));
  console.log(JSON.stringify({pass:true,checks},null,2));
}catch(err){
  console.error(JSON.stringify({pass:false,checks,error:String(err)},null,2));process.exitCode=1;
}finally {
  fs.rmSync(base,{recursive:true,force:true});
}
