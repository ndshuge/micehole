#!/usr/bin/env node
/** Same project-file workflow as construction://, for local recovery and scripts. */
import { DEFAULT_WORKSPACE } from '../../mcp/remote/bridge-core.mjs';
import { constructionCall, createConstructionContext } from '../../mcp/remote/mouse-hole-construction-state.mjs';
const values=process.argv.slice(2), operation=values.shift()||'status';
const args={operation};let workspace=process.env.MOUSE_HOLE_WORKSPACE||DEFAULT_WORKSPACE;
const options={project:'project',name:'name',cwd:'cwd',goal:'goal','end-condition':'end_condition',phase:'current_phase',gate:'current_gate',step:'current_step',checkpoint:'checkpoint','next-action':'next_action',state:'state',outcome:'outcome',blocker:'blocked_reason',validation:'last_validation'};
try{
 while(values.length){
  const option=values.shift();
  if(option==='--import-legacy'){args.import_legacy=true;continue}
  if(option==='--workspace'){if(!values.length)throw new Error('Missing workspace');workspace=values.shift();continue}
  const key=options[option.replace(/^--/,'')];
  if(!option.startsWith('--')||!key||!values.length)throw new Error('Unsupported or incomplete option: '+option);
  args[key]=values.shift();
 }
 const result=constructionCall(workspace,args,createConstructionContext());
 console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:1;
}catch(error){console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1}
