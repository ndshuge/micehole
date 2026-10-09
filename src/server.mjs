#!/usr/bin/env node
import readline from "node:readline";
import { dispatch, loadConfig } from "./core.mjs";
const shape=(properties,required=[])=>({type:"object",properties,required,additionalProperties:false});
const s={type:"string"},n={type:"integer"};
const tools=[
["mouse_hole_status","Check local engine and workspace readiness",{},[],true],
["mouse_hole_read","Read a UTF-8 file in the configured workspace",{path:s,offset:n,length:n},["path"],true],
["mouse_hole_write","Write a UTF-8 file in the workspace",{path:s,content:s},["path","content"],false],
["mouse_hole_patch","Replace an exact match in a text file",{path:s,old_string:s,new_string:s,expected_replacements:n},["path","old_string","new_string"],false],
["mouse_hole_search","Search file contents or file names in the workspace",{path:s,pattern:s,search_type:{type:"string",enum:["files","content"]},limit:n},["pattern"],true],
["mouse_hole_run","Run a bounded shell command. WARNING: code execution under user permissions.",{command:s,cwd:s,timeout_ms:n},["command"],false],
["mouse_hole_process","Run or inspect a persistent command",{operation:{type:"string",enum:["start","wait","status","output","stop"]},command:s,cwd:s,timeout_ms:n,process_id:n,wait_ms:n,offset:n},["operation"],false],
["mouse_hole_git","Read git status or diff statistics",{operation:{type:"string",enum:["status","diff"]},cwd:s},["operation"],true],
["mouse_hole_validate","Run project validation and return exit status",{command:s,cwd:s,timeout_ms:n},["command"],false]
].map(([name,description,props,required,readOnlyHint])=>({name,description,inputSchema:shape(props,required),annotations:{readOnlyHint,destructiveHint:!readOnlyHint,openWorldHint:false}}));
function result(id,value){return {jsonrpc:"2.0",id,result:value};}
function rpcError(id,code,message){return {jsonrpc:"2.0",id,error:{code,message}};}
async function handle(m){
  const p=m.params||{};
  if(m.method==="initialize")return result(m.id,{protocolVersion:"2025-06-18",serverInfo:{name:"micehole-universal",version:"0.1.0"},capabilities:{tools:{}}});
  if(m.method==="notifications/initialized"||m.method==="notifications/cancelled")return null;
  if(m.method==="ping")return result(m.id,{});
  if(m.method==="tools/list")return result(m.id,{tools});
  if(m.method==="tools/call"){
    const tool=tools.find(t=>t.name===p.name);
    if(!tool)return rpcError(m.id,-32602,"Unknown tool");
    const a=p.arguments||{};
    if(!a||typeof a!=="object"||Array.isArray(a))return rpcError(m.id,-32602,"Expected object arguments");
    for(const key of tool.inputSchema.required)if(typeof a[key]==="undefined")return rpcError(m.id,-32602,"Missing "+key);
    for(const [key,val] of Object.entries(a)){
      const schema=tool.inputSchema.properties[key];
      if(!schema)return rpcError(m.id,-32602,"Unexpected argument "+key);
      if(schema.type==="string"&&typeof val!=="string"||schema.type==="integer"&&!Number.isInteger(val))return rpcError(m.id,-32602,"Invalid type for "+key);
      if(schema.enum&&!schema.enum.includes(val))return rpcError(m.id,-32602,"Invalid value for "+key);
    }
    try{
      const data=await dispatch(p.name,a);
      return result(m.id,{content:[{type:"text",text:JSON.stringify(data)}],isError:data.ok===false});
    }catch(e){
      const data={ok:false,operation:p.name,error:String(e?.message||e).slice(0,500)};
      return result(m.id,{content:[{type:"text",text:JSON.stringify(data)}],isError:true});
    }
  }
  if(m.id===undefined)return null;
  return rpcError(m.id,-32601,"Method not found");
}
if(process.argv.includes("--doctor")){
  try{const cfg=loadConfig();process.stdout.write(JSON.stringify({ready:true,workspace:cfg.root,executionEnabled:cfg.executionEnabled,node:process.version})+"\n");}
  catch(e){process.stderr.write("MiceHole Doctor: "+String(e.message)+"\n");process.exitCode=1;}
}else{
  const rl=readline.createInterface({input:process.stdin,terminal:false});
  const pending=new Set();
  rl.on("line",line=>{
    if(!line.trim())return;
    let message;
    try{message=JSON.parse(line);}catch{process.stdout.write(JSON.stringify(rpcError(null,-32700,"Invalid JSON"))+"\n");return;}
    const work=Promise.resolve(handle(message)).then(res=>{if(res)process.stdout.write(JSON.stringify(res)+"\n")}).catch(e=>{
      if(message.id!==undefined)process.stdout.write(JSON.stringify(rpcError(message.id,-32603,String(e.message)))+"\n");
    });
    pending.add(work);work.finally(()=>pending.delete(work));
  });
}
