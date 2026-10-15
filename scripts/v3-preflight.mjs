#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const checks = [];
function add(name, ok, detail) { checks.push({name, ok, detail}); }
const required = [
  'src/server.mjs', 'src/core.mjs', 'scripts/build-release.ps1',
  'scripts/setup-config.ps1', 'docs/SELF-HOSTED.md', 'docs/SECURITY.md',
];
for (const rel of required) add(rel, fs.existsSync(path.join(root,rel)), 'required distribution component');
const src = fs.readFileSync(path.join(root,'src/server.mjs'),'utf8');
for (const disallowed of ['mouse_hole_godot','mouse_hole_blender','mouse_hole_comfyui'])
  add('exclude '+disallowed, !src.includes(disallowed), 'specialized integration must not be exported');
add('remote shell blocked', fs.readFileSync(path.join(root,'src/core.mjs'),'utf8').includes('Remote shell execution locked'), 'public tunnel must not offer unsandboxed shell');
const cfg = path.join(os.homedir(),'AppData','Local','MiceHole','config.json');
add('private config never embedded', !fs.existsSync(path.join(root,'config.json')), 'per-user config should not enter repository');
const node = spawnSync(process.execPath,['--check',path.join(root,'src/server.mjs')],{encoding:'utf8'});
add('Node syntax',node.status===0,(node.stderr||'').slice(0,500));
console.log(JSON.stringify({product:'MiceHole V3 preflight',checks,passed:checks.filter(x=>x.ok).length,total:checks.length,ready:checks.every(x=>x.ok)},null,2));
if(checks.some(x=>!x.ok))process.exitCode=1;
