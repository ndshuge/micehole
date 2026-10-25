/**
 * Read-only hybrid routing: Edge for page content, Ego AX tree for controls.
 * Does not modify browser defaults or import user cookies. Failures are reported
 * explicitly. Ego fallback returns DOM, never mislabels it an AX snapshot.
 */
import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {browserDumpDom,closeBrowserSessions} from "../../mcp/remote/browser-cdp.mjs";
import {egoAvailable,egoTask} from "./ego-hybrid-runtime.mjs";

const ROOT=process.env.MOUSE_HOLE_WORKSPACE || "E:/CHATGPT";
const EDGE=process.env.EDGE_BIN || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

export function pickBackend({intent="content",prefer="auto"}={}) {
 if(!["content","controls"].includes(intent))throw Error("unsupported_intent");
 if(!["auto","edge","ego"].includes(prefer))throw Error("unsupported_preference");
 return prefer==="auto"?(intent==="controls"?"ego":"edge"):prefer;
}
function safeWebUrl(url) {
 const parsed=new URL(String(url||""));
 if(!["http:","https:"].includes(parsed.protocol)||parsed.username||parsed.password)throw Error("invalid_url");
 return parsed.href;
}
async function readEdge(url,maxChars) {
 if(!fs.existsSync(EDGE))throw Error("edge_not_available");
 const d=await browserDumpDom({root:ROOT,browserBin:EDGE,url,reuseSession:true,maxChars});
 return {ok:true,backend:"edge_cdp",semantic:false,text:d.dom,truncated:d.truncated??false};
}
async function readEgo(url,maxChars,space) {
 if(!egoAvailable())throw Error("ego_not_available");
 const r=await egoTask({operation:"snapshot",url,space,maxChars,timeoutMs:16000});
 if(!r.ok)throw Error("ego_failed:"+String(r.error||r.stderr||"unknown").slice(0,230));
 return {ok:true,backend:"ego_windows_host",semantic:true,text:r.stdout.slice(0,maxChars),truncated:r.stdout.length>maxChars};
}
export async function smartRead({url,intent="content",prefer="auto",space="smart-read",maxChars=12000,allowFallback=true}={}) {
 const link=safeWebUrl(url);
 if(!/^[a-zA-Z0-9_-]{1,48}$/.test(space))throw Error("invalid_space");
 const limit=Math.min(Math.max(Number(maxChars)||12000,1000),60000);
 const chosen=pickBackend({intent,prefer});
 const started=performance.now();
 const transientSpace=space.slice(0,27)+"-"+randomUUID().slice(0,12);
 let result=null,fallback=null,cleanup=null;
 if(chosen==="ego") {
  try {result=await readEgo(link,limit,transientSpace);}
  catch(e) {
   if(!allowFallback)throw e;
   fallback={from:"ego_windows_host",to:"edge_cdp",reason:String(e.message||e).slice(0,260)};
   result=await readEdge(link,limit);
  } finally {
   // Transient, uniquely named Space prevents one request closing another.
   if(egoAvailable()) {
    try {const r=await egoTask({operation:"close",space:transientSpace,timeoutMs:6000});
     cleanup={attempted:true,ok:r.ok};}
    catch(e){cleanup={attempted:true,ok:false,error:String(e.message||e).slice(0,200)};}
   } else cleanup={attempted:false,ok:null};
  }
 } else result=await readEdge(link,limit);
 return {...result,requested_intent:intent,selected_backend:chosen,fallback,cleanup,
  duration_ms:Math.round(performance.now()-started)};
}
export async function closeSmartReadSessions(){await closeBrowserSessions();}
