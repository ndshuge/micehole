import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertGuiPolicy, assertBrowserForegroundPolicy, isQuadrantEnabled } from "../../direct/mcp/remote/gui-background-policy.mjs";
import { mouseHoleCoreCall } from "../../direct/mcp/remote/mouse-hole-core.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const off={};
const on={MOUSE_HOLE_GUI_FOREGROUND_MODE:"allow",MOUSE_HOLE_GUI_LAYOUT:"quadrant"};
assert.equal(assertGuiPolicy({operation:"status"},off),"passive");
assert.equal(assertGuiPolicy({operation:"wait"},off),"passive");
assert.equal(assertGuiPolicy({operation:"click",foreground_control:true,title:"Fixture",text:"OK"},off),"semantic_background");
assert.throws(()=>assertGuiPolicy({operation:"click",x:5,y:6,foreground_control:true},off),/disabled by default/);
assert.throws(()=>assertGuiPolicy({operation:"launch",foreground_control:true},off),/disabled by default/);
assert.throws(()=>assertGuiPolicy({operation:"move",x:5,y:6},on),/foreground_control=true/);
assert.throws(()=>assertGuiPolicy({operation:"type_text",foreground_control:true},on),/Exact target window title/);
assert.equal(assertGuiPolicy({operation:"type_text",foreground_control:true,title:"Fixture",text:"ok"},on),"foreground_opt_in");
assert.equal(assertGuiPolicy({operation:"focus_window",foreground_control:true,title:"Fixture"},on),"foreground_opt_in");
assert.throws(()=>assertBrowserForegroundPolicy({foreground_control:true},off),/disabled by default/);
assert.throws(()=>assertBrowserForegroundPolicy({},on),/foreground_control=true/);
assert.doesNotThrow(()=>assertBrowserForegroundPolicy({foreground_control:true},on));
assert.equal(isQuadrantEnabled(off),false);
assert.equal(isQuadrantEnabled(on),true);
// The public core must enforce the policy before spawning any foreground input.
await assert.rejects(
  mouseHoleCoreCall(root,"mouse_hole_gui",{operation:"move",x:4,y:5,foreground_control:true}),
  /disabled by default/
);
await assert.rejects(
  mouseHoleCoreCall(root,"mouse_hole_browser",{operation:"open_foreground",url:"https://example.com",foreground_control:true}),
  /disabled by default/
);
if(process.platform==="win32"){
  const gui=path.join(root,"direct/mcp/remote/gui-windows.ps1");
  const run=(args,env)=>spawnSync("powershell.exe",["-NoProfile","-NonInteractive","-Sta","-ExecutionPolicy","Bypass","-File",gui,...args],{
    windowsHide:true,encoding:"utf8",timeout:7500,env:{...process.env,MOUSE_HOLE_GUI_FOREGROUND_MODE:"",...env}
  });
  const status=run(["-Operation","status"],off);
  assert.equal(status.status,0,status.stderr);
  const denied=run(["-Operation","focus_window","-Title","MiceHoleDoesNotExist"],off);
  assert.notEqual(denied.status,0);
  assert.match(denied.stderr,/Foreground GUI disabled by default/);
  const placement=path.join(root,"direct/mcp/remote/gui-placement.ps1");
  const skip=spawnSync("powershell.exe",["-NoProfile","-NonInteractive","-Sta","-ExecutionPolicy","Bypass","-File",placement,
    "-Mode","place","-ExpectedPid","999999","-ProcessName","__missing__","-WaitMs","0"],{
      windowsHide:true,encoding:"utf8",timeout:7500,env:{...process.env,MOUSE_HOLE_GUI_LAYOUT:""}
    });
  assert.equal(skip.status,0,skip.stderr);
  assert.match(skip.stdout,/layout_disabled/);
}
console.log("BACKGROUND_GUI_POLICY=PASS");
