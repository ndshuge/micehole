#!/usr/bin/env node
// Regression: process bookkeeping must not alter durable project memory.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'micehole-habit-'));
const project=path.join(workspace,'projects','demo');
fs.mkdirSync(project,{recursive:true});
fs.writeFileSync(path.join(workspace,'AGENTS.md'),'# Workspace rules\n');
fs.writeFileSync(path.join(project,'AGENTS.md'),'# Demo rules\n');
const child=spawn(process.execPath,[path.join(repo,'direct','mcp','remote','mouse-hole-server.mjs')],{
  cwd:repo,env:{...process.env,MOUSE_HOLE_WORKSPACE:workspace,MOUSE_HOLE_DIAGNOSTIC_PROBE:'1'},
  stdio:['pipe','pipe','pipe'],windowsHide:true
});
let stderr='';
child.stderr.on('data',part=>{stderr=(stderr+part.toString()).slice(-2000)});
const lines=readline.createInterface({input:child.stdout});
let nextId=1;
const waiting=new Map();
lines.on('line',line=>{
  let msg;
  try{msg=JSON.parse(line)}catch{return}
  const pending=waiting.get(msg.id);
  if(pending){waiting.delete(msg.id);pending.resolve(msg)}
});
child.on('exit',()=>{for(const [id,p] of waiting){waiting.delete(id);p.reject(new Error('Server exited: '+stderr))}});
const rpc=(method,params={})=>new Promise((resolve,reject)=>{
  const id=nextId++;
  const timer=setTimeout(()=>{waiting.delete(id);reject(new Error('MCP RPC timeout '+method+': '+stderr))},16000);
  waiting.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
});
const tool=async(name,args)=>{
  const resp=await rpc('tools/call',{name,arguments:args});
  assert.equal(resp.error,undefined,JSON.stringify(resp.error));
  assert.notEqual(resp.result?.isError,true,JSON.stringify(resp.result));
  const payload=JSON.parse(resp.result.content[0].text);
  assert.equal(payload.ok,true,JSON.stringify(payload));
  return payload;
};
const memory=()=>Object.fromEntries(['PROJECT.md','STATUS.md','TODO.md','LOG.md'].map(name=>[name,fs.readFileSync(path.join(project,name),'utf8')]));
const checks=[];
try{
  const init=await rpc('initialize',{protocolVersion:'2025-11-25'});
  assert.match(init.result.instructions,/AGENTS\.md/);
  const tools=await rpc('tools/list');
  assert.equal(tools.result.tools.length,15);
  checks.push('portable instructions and vNext 15-tool surface');

  await tool('mouse_hole_write',{path:'construction://start',content:JSON.stringify({
    project:'projects/demo',goal:'Check memory lifecycle',current_phase:'testing',
    next_action:'run isolated regression',end_condition:'pass'
  })});
  const original=memory();
  const resumed=await tool('mouse_hole_read',{path:'construction://continue?project=projects%2Fdemo'});
  assert.equal(resumed.continuation.rule_entry.global_rules,path.join(workspace,'AGENTS.md'));
  assert.equal(resumed.continuation.rule_entry.project_rules,path.join(project,'AGENTS.md'));
  assert.deepEqual(memory(),original);
  checks.push('project-scoped rules are discoverable without read-time mutations');

  await tool('mouse_hole_write',{path:'construction://checkpoint',content:JSON.stringify({project:'projects/demo',current_phase:'testing',next_action:'run isolated regression'})});
  assert.deepEqual(memory(),original);
  checks.push('unchanged checkpoint has no MD side effects');

  // The portable test exercises the published stdio surface; some deployments
  // deliberately have no long-process backend. Test the code boundary here and
  // use an authorized runtime for a successful process.start/wait integration.
  const serverSource=fs.readFileSync(path.join(repo,'direct','mcp','remote','mouse-hole-server.mjs'),'utf8');
  assert.doesNotMatch(serverSource,/patchConstructionState\s*\(/);
  assert.doesNotMatch(serverSource,/next_action:\s*"(?:continue_plan|wait_for_process)"/);
  assert.deepEqual(memory(),original);
  checks.push('process lifecycle cannot persist automatic project checkpoints');

  await tool('mouse_hole_write',{path:'construction://checkpoint',content:JSON.stringify({
    project:'projects/demo',current_phase:'verified',
    checkpoint:'portable project memory and process source boundary verified',
    last_validation:'portable MCP assertions pass; long-process runtime not exercised',
    next_action:'review next authorized task'
  })});
  const updated=memory();
  assert.match(updated['STATUS.md'],/Phase: "verified"/);
  assert.match(updated['LOG.md'],/checkpoint/);
  await tool('mouse_hole_write',{path:'construction://checkpoint',content:JSON.stringify({
    project:'projects/demo',current_phase:'verified',
    checkpoint:'portable project memory and process source boundary verified',
    last_validation:'portable MCP assertions pass; long-process runtime not exercised',
    next_action:'review next authorized task'
  })});
  assert.deepEqual(memory(),updated);
  checks.push('explicit milestone persists once; repeating it is idempotent');
  console.log(JSON.stringify({ok:true,count:checks.length,checks}));
}finally{
  child.stdin.end();
  const timer=setTimeout(()=>child.kill(),1500);
  timer.unref();
  lines.close();
}