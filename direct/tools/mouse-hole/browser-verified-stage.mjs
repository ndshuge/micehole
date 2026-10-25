import fs from "node:fs";
import path from "node:path";
import {performance} from "node:perf_hooks";
import {browserFill,browserClick,browserInspect,closeBrowserSessions} from "../../mcp/remote/browser-cdp.mjs";
// One short, deterministic, bounded browser stage executed inside one remote call.
// No new MCP surface, agent, queue or persistent process is installed.
const ROOT=path.resolve(process.env.MOUSE_HOLE_WORKSPACE||"E:\\CHATGPT");
function safe(value){
 const p=path.resolve(value);
 const rel=path.relative(ROOT,p);
 if(rel===".."||rel.startsWith(".."+path.sep)||path.isAbsolute(rel))throw Error("File outside workspace");
 return p;
}
function parse(argv){
 const m=argv.indexOf("--manifest");
 if(m<0||m+1>=argv.length||argv.length!==2)throw Error("Usage: node browser-verified-stage.mjs --manifest WORKSPACE.json");
 return safe(argv[1]);
}
const manifest=JSON.parse(fs.readFileSync(parse(process.argv.slice(2)),"utf8"));
const {url,steps,receipt}=manifest;
if(typeof url!=="string"||!/^https?:\/\//i.test(url))throw Error("HTTP(S) url required");
if(!Array.isArray(steps)||steps.length===0||steps.length>12)throw Error("1-12 steps required");
if(receipt && (fs.existsSync(safe(receipt))||!fs.existsSync(path.dirname(safe(receipt)))))throw Error("Receipt exists or output directory missing");
const base={root:ROOT,browserBin:process.env.MOUSE_HOLE_EDGE||"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
 url,reuseSession:true};
const responses=[];const started=performance.now();
async function verify(expected){
 const selector=expected.selector;
 if(typeof selector!=="string"||selector.length>1024)throw Error("Verification selector required");
 const field=expected.field;
 if(!["value","text"].includes(field))throw Error("Verification field must be text or value");
 const equals=expected.equals;
 if(typeof equals!=="string"||equals.length>2000)throw Error("Expected value must be string <= 2000 chars");
 const deadline=Date.now()+Math.min(5000,Math.max(100,Number(expected.timeout_ms)||2000));
 let attempt=0,last=null;
 do{
  const info=await browserInspect({...base,selector,waitMs:150});
  last=info?.element?.[field];
  if(last===equals)return {verified:true,selector,field,equals,attempts:attempt+1};
  await new Promise(r=>setTimeout(r,Math.min(120,Math.max(10,deadline-Date.now()))));
  attempt++;
 }while(Date.now()<deadline);
 throw Error("Postcondition failed at "+selector+": expected "+JSON.stringify(equals)+" got "+JSON.stringify(last));
}
try{
 for(let i=0;i<steps.length;i++){
  const step=steps[i],st=performance.now();
  if(!step||typeof step!=="object"||!["fill","click","verify"].includes(step.type))throw Error("Unsupported step "+i);
  if(!step.verify||typeof step.verify!=="object")throw Error("Every step requires a postcondition");
  if(["fill","click"].includes(step.type) && (typeof step.selector!=="string"||step.selector.length>1024))throw Error("Action selector invalid");
  if(step.type==="fill"){
   if(typeof step.text!=="string"||step.text.length>2000)throw Error("Fill data invalid");
   await browserFill({...base,selector:step.selector,text:step.text,verifiedFast:true,waitMs:3000});
  }else if(step.type==="click"){
   if(manifest.allow_click!==true)throw Error("Click actions require allow_click=true in an explicitly authorized manifest");
   await browserClick({...base,selector:step.selector,verifiedFast:true,waitMs:3000});
  }
  const state=await verify(step.verify);
  responses.push({index:i,type:step.type,elapsed_ms:+(performance.now()-st).toFixed(2),...state});
 }
 const report={ok:true,backend:"bounded_cdp_verified_stage",url,steps:responses,
  total_ms:+(performance.now()-started).toFixed(2)};
 if(receipt)fs.writeFileSync(safe(receipt),JSON.stringify(report,null,2));
 console.log("BROWSER_STAGE "+JSON.stringify(report));
}catch(error){
 const failure={ok:false,steps:responses,elapsed_ms:+(performance.now()-started).toFixed(2),error:String(error).slice(0,500)};
 if(receipt&&!fs.existsSync(safe(receipt)))fs.writeFileSync(safe(receipt),JSON.stringify(failure,null,2));
 console.error("BROWSER_STAGE_FAILED "+JSON.stringify(failure));
 process.exitCode=1;
}finally{
 await closeBrowserSessions();
}
