import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(),'micehole-friend-'));
const child=spawn(process.execPath,[path.join(repo,'direct','mcp','remote','mouse-hole-server.mjs')],{cwd:repo,env:{...process.env,MOUSE_HOLE_WORKSPACE:workspace},stdio:['pipe','pipe','pipe'],windowsHide:true});
let stderr='';child.stderr.on('data',b=>stderr+=b.toString().slice(0,2500));
let serial=0;const wait=new Map();
readline.createInterface({input:child.stdout}).on('line',line=>{try{const result=JSON.parse(line);const found=wait.get(result.id);if(found){wait.delete(result.id);found(result)}}catch{}});
function ask(method,params){return new Promise((resolve,reject)=>{const id=++serial;const timer=setTimeout(()=>{wait.delete(id);reject(Error('MCP timeout: '+method))},8000);wait.set(id,x=>{clearTimeout(timer);resolve(x)});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')})}
const reports=[];
try{
const init=await ask('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'friend-test',version:'1'}});
reports.push(['handshake',init.result?.serverInfo?.name==='mouse-hole']);
const names=(await ask('tools/list',{})).result.tools.map(x=>x.name);
reports.push(['exactly 12 tools',names.length===12]);
reports.push(['specialists absent',['mouse_hole_godot','mouse_hole_blender','mouse_hole_comfyui'].every(n=>!names.includes(n))]);
reports.push(['high privilege tools advertised',['mouse_hole_run','mouse_hole_process','mouse_hole_git','mouse_hole_gui','mouse_hole_browser'].every(n=>names.includes(n))]);
const state=await ask('tools/call',{name:'mouse_hole_status',arguments:{}});
reports.push(['status',state.result?.isError!==true]);
const write=await ask('tools/call',{name:'mouse_hole_write',arguments:{path:'friend-test.txt',content:'independent'}});reports.push(['write',write.result?.isError!==true]);
reports.push(['isolated directory',fs.existsSync(path.join(workspace,'friend-test.txt'))]);
console.log(JSON.stringify({pass:reports.every(x=>x[1]),reports,workspace,stderr:stderr.slice(0,500)},null,2));
if(reports.some(x=>!x[1]))process.exitCode=1;
}catch(e){console.error(String(e),stderr.slice(0,700));process.exitCode=1}finally{child.stdin.end();setTimeout(()=>{if(!child.killed)child.kill()},500).unref()}
