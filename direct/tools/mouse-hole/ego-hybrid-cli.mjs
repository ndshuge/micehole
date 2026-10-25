#!/usr/bin/env node
import {egoAvailable,egoTask} from "./ego-hybrid-runtime.mjs";
const [op="doctor",url,space="default"] = process.argv.slice(2);
if(op==="availability"){console.log(JSON.stringify({ok:egoAvailable()}));process.exit(egoAvailable()?0:2)}
else {
 try{
  const r=await egoTask({operation:op,url:op==="close"?undefined:url,space:op==="close"?(url||"default"):space});
  console.log(JSON.stringify({ok:r.ok,backend:r.backend,operation:r.operation,ms:r.duration_ms,output:r.stdout?.slice(0,14000),error:r.ok?null:r.stderr||r.error||"unknown",timeout:r.timeout||false}));
  if(!r.ok) process.exitCode=1;
 }catch(e){console.error(JSON.stringify({ok:false,error:String(e.message||e)}));process.exitCode=1}
}
