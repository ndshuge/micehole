import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function repoRoot(root) {
  if (process.env.HANAKO_OPENHANAKO_ROOT) return process.env.HANAKO_OPENHANAKO_ROOT;
  const workspaceRepo = path.join(root, "projects", "openhanako-runtime");
  if (fs.existsSync(path.join(workspaceRepo, "oh_runtime"))) return workspaceRepo;
  return SOURCE_ROOT;
}

function payloadDir(root) {
  const dir = path.join(root, "work", "bridge", "vnext-payloads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function psQuote(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}

export function writeAdapterPayload(root, payload) {
  const file = path.join(payloadDir(root), randomUUID() + ".json");
  fs.writeFileSync(file, JSON.stringify(payload ?? {}), "utf8");
  return file;
}

export function adapterCommand(root, adapter, operation, payloadFile) {
  const repo = repoRoot(root);
  const python = process.env.HANAKO_PYTHON || "python";
  return [
    `& ${psQuote(python)}`,
    "-m oh_runtime.adapter_cli",
    `--workspace ${psQuote(root)}`,
    `--adapter ${psQuote(adapter)}`,
    `--operation ${psQuote(operation)}`,
    `--payload-file ${psQuote(payloadFile)}`,
    "--delete-payload-file",
  ].join(" ");
}

function parseLastJson(stdout) {
  const lines = String(stdout || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const value = JSON.parse(lines[i]);
      if (value && typeof value === "object") return value;
    } catch {}
  }
  return null;
}

export function runAdapterSync(root, adapter, operation, payload, timeoutMs = 30000) {
  const file = writeAdapterPayload(root, payload);
  const python = process.env.HANAKO_PYTHON || "python";
  const repo = repoRoot(root);
  const args = [
    "-m", "oh_runtime.adapter_cli",
    "--workspace", root,
    "--adapter", adapter,
    "--operation", operation,
    "--payload-file", file,
    "--delete-payload-file",
  ];
  const child = spawnSync(python, args, {
    cwd: repo,
    encoding: "utf8",
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (fs.existsSync(file)) {
    try { fs.unlinkSync(file); } catch {}
  }
  const parsed = parseLastJson(child.stdout);
  if (parsed) return parsed;
  if (child.error) throw child.error;
  throw new Error(String(child.stderr || child.stdout || "adapter call failed").slice(0, 4000));
}


// Nonblocking equivalent of runAdapterSync: Runtime can serve unrelated requests
// while a Blender/Godot process is working; this is not a Worker Agent or task queue.
export async function runAdapterAsync(root, adapter, operation, payload, timeoutMs = 30000) {
  const file = writeAdapterPayload(root, payload);
  const python = process.env.HANAKO_PYTHON || "python";
  const args = [
    "-m", "oh_runtime.adapter_cli",
    "--workspace", root,
    "--adapter", adapter,
    "--operation", operation,
    "--payload-file", file,
    "--delete-payload-file",
  ];
  const timeout = Math.max(1000,Math.min(Number(timeoutMs)||30000,600000));
  try {
    return await new Promise((resolve,reject)=>{
      const child=spawn(python,args,{cwd:repoRoot(root),windowsHide:true,stdio:["ignore","pipe","pipe"]});
      let stdout="",stderr="",settled=false,expired=false;
      const finish=(err,result)=>{
        if(settled)return;
        settled=true;
        clearTimeout(timer);
        if(err)reject(err);else resolve(result);
      };
      const timer=setTimeout(()=>{expired=true;child.kill();},timeout);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data",chunk=>{
        stdout+=chunk;
        if(stdout.length>2*1024*1024) {expired=true;child.kill();}
      });
      child.stderr.on("data",chunk=>{stderr=(stderr+chunk).slice(-4000);});
      child.once("error",error=>finish(error));
      child.once("close",code=>{
        if(expired)return finish(new Error("Adapter operation timed out or exceeded output budget"));
        const parsed=parseLastJson(stdout);
        if(parsed)return finish(null,parsed);
        return finish(new Error((stderr||stdout||("Adapter process exited "+code)).slice(-4000)));
      });
    });
  } finally {
    if(fs.existsSync(file))try{fs.unlinkSync(file)}catch{}
  }
}

export function adapterRepoCwd(root) {
  return repoRoot(root);
}
