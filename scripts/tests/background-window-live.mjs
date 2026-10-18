import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mouseHoleCoreCall } from "../../direct/mcp/remote/mouse-hole-core.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const title="MiceHole Background Capture QA";
const fixture=path.join(root,"scripts","tests","gui-background-fixture.ps1");
const child=spawn("powershell.exe",["-NoProfile","-NonInteractive","-Sta","-ExecutionPolicy","Bypass","-File",fixture],{
 windowsHide:true,stdio:"ignore",env:{...process.env,MOUSE_HOLE_GUI_FOREGROUND_MODE:""}
});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 let observed, failure;
 for(let i=0;i<25;i++){
   await pause(300);
   try{
     observed=await mouseHoleCoreCall(root,"mouse_hole_observe",{target:"window",title,path:"background"});
     if(observed.ok) break;
   }catch(error){failure=String(error);}
 }
 assert(observed?.ok, failure||"No valid background capture");
 assert.equal(observed.metadata.backend,"win32_printwindow_background");
 assert(observed.metadata.sampled_colors>=3);
 assert(observed.metadata.width>=300);
 assert(observed.__mcp_content?.[0]?.data?.length>300);
 assert(fs.existsSync(observed.path));
 const clicked=await mouseHoleCoreCall(root,"mouse_hole_gui",{operation:"click",title,text:"TEST CLICK",foreground_control:true});
 assert.equal(clicked.ok,true);
 assert.equal(clicked.metadata.global_mouse_input_used,false);
 assert.equal(clicked.metadata.message_delivered,true);
 const after=await mouseHoleCoreCall(root,"mouse_hole_observe",{target:"window",title,path:"background"});
 assert(after.ok);
 assert.notEqual(observed.__mcp_content[0].data,after.__mcp_content[0].data,"button effect should change frame");
 console.log("BACKGROUND_CAPTURE_LIVE=PASS",JSON.stringify({
   bytes:observed.metadata.bytes,sampled_colors:observed.metadata.sampled_colors,width:observed.metadata.width,height:observed.metadata.height,button_clicked:true
 }));
 // The test fixture owns the process; never leave windows or captures behind.
 fs.rmSync(observed.path,{force:true});
 fs.rmSync(after.path,{force:true});
}finally{
 child.kill();
}
