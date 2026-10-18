import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {spawn,execFile} from "node:child_process";
import {promisify} from "node:util";
import {fileURLToPath} from "node:url";
import {mouseHoleCoreCall} from "../../direct/mcp/remote/mouse-hole-core.mjs";
const exec=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const title="MiceHole Background Capture QA",fixture=spawn("powershell.exe",["-NoProfile","-Sta","-ExecutionPolicy","Bypass","-File",path.join(root,"scripts/tests/gui-background-fixture.ps1")],{windowsHide:true,stdio:"ignore"});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const end=Date.now()+30000;
const count={captures:0,clicks:0,cli:0,focusSamples:0,fixtureFocus:0,frontTitles:new Set(),errors:[]};
try{
  let ready=false;
  for(let n=0;n<22;n++){try{
    let x=await mouseHoleCoreCall(root,"mouse_hole_observe",{target:"window",title,path:"background"});
    fs.rmSync(x.path,{force:true});ready=true;break;
  }catch{await sleep(150)}}
  assert(ready,"test fixture not found");
  const observe=async()=>{
    while(Date.now()<end){
      const x=await mouseHoleCoreCall(root,"mouse_hole_observe",{target:"window",title,path:"background"});
      assert(x.ok&&x.metadata.sampled_colors>=3);
      fs.rmSync(x.path,{force:true});count.captures++;await sleep(600);
    }
  };
  const click=async()=>{
    while(Date.now()<end){
      const x=await mouseHoleCoreCall(root,"mouse_hole_gui",{operation:"click",title,text:"TEST CLICK",foreground_control:true});
      assert(x.ok && x.metadata.cursor_unchanged===true);
      count.clicks++;await sleep(900);
    }
  };
  const cli=async()=>{
    while(Date.now()<end){
      const r=await exec(process.execPath,["-e","console.log(require('crypto').createHash('sha256').update('background-qa').digest('hex').slice(0,12))"],{windowsHide:true,timeout:4000});
      assert.equal(r.stdout.trim().length,12);count.cli++;await sleep(420);
    }
  };
  const monitor=async()=>{
    while(Date.now()<end){
      const script="import win32gui;h=win32gui.GetForegroundWindow();print(win32gui.GetWindowText(h))";
      const r=await exec("python",["-c",script],{windowsHide:true,timeout:3500});
      const t=r.stdout.trim();
      count.frontTitles.add(t);
      if(t===title)count.fixtureFocus++;
      count.focusSamples++;await sleep(300);
    }
  };
  const outcomes=await Promise.allSettled([observe(),click(),cli(),monitor()]);
  outcomes.forEach((r,i)=>{if(r.status==="rejected")count.errors.push("lane"+i+":"+String(r.reason))});
  assert.deepEqual(count.errors,[]);
  assert.equal(count.fixtureFocus,0,"foreground was stolen by fixture");
  for(const k of ["captures","clicks","cli","focusSamples"])assert(count[k]>=5,"Insufficient "+k);
  console.log("MULTI_AGENT_BACKGROUND_30S=PASS",JSON.stringify({...count,frontTitles:[...count.frontTitles]}));
}finally{fixture.kill()}
