import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"micehole-history-audit-"));
const script=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../public-history-audit.py");
function run(command,args,cwd=dir){
  return spawnSync(command,args,{cwd,encoding:"utf8",windowsHide:true,timeout:12000});
}
try{
  let x=run("git",["init","-q"]); assert.equal(x.status,0,x.stderr);
  x=run("git",["config","user.email","fixture@example.invalid"]);assert.equal(x.status,0,x.stderr);
  x=run("git",["config","user.name","Fixture"]);assert.equal(x.status,0,x.stderr);
  // Construct a new local development path at runtime so the regression
  // test source itself never contains a literal personal path.
  const privatePath=["E:", "CHAT"+"GPT", "something.txt"].join(String.fromCharCode(92));
  fs.writeFileSync(path.join(dir,"new-sensitive-path.txt"),"malicious-new-reference="+privatePath+"\n");
  x=run("git",["add","."]);assert.equal(x.status,0,x.stderr);
  x=run("git",["commit","-qm","security fixture"]);assert.equal(x.status,0,x.stderr);
  x=run("python",[script]);assert.equal(x.status,2,x.stdout+x.stderr);
  assert.match(x.stdout,/private-workspace-path/);
  assert.match(x.stdout,/HISTORY_PRIVACY_REVIEW=BLOCKED/);
  console.log("HISTORICAL_AUDIT_NEW_PATH_DENIED=PASS");
}finally{
  fs.rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:200});
}
