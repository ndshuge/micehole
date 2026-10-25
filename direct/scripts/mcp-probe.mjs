#!/usr/bin/env node
// Cross-Windows MCP probe. PowerShell never writes JSON-RPC to Node's stdin.
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const server=process.argv[2];
if(!server || !path.isAbsolute(server)){console.error('Absolute MCP server path required');process.exit(2)}
const request=JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})+'\n';
const result=spawnSync(process.execPath,[server],{input:Buffer.from(request,'utf8'),encoding:'utf8',timeout:12000,windowsHide:true,maxBuffer:1024*1024,env:process.env});
if(result.error || result.status!==0){console.error('MCP probe process failed:',result.error?.message ?? result.stderr?.slice(-400) ?? result.status);process.exit(3)}
const line=String(result.stdout).split(/\r?\n/).find(x=>x.startsWith('{"jsonrpc"'));
if(!line){console.error('MCP protocol response missing');process.exit(4)}
let reply;
try{reply=JSON.parse(line)}catch{console.error('MCP response invalid JSON');process.exit(5)}
if(reply.error || !Array.isArray(reply.result?.tools)){console.error('MCP response error:',reply.error?.code);process.exit(6)}
process.stdout.write(JSON.stringify({tools:reply.result.tools.map(x=>x.name),count:reply.result.tools.length})+'\n');
