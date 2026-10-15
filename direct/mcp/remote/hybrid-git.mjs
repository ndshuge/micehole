import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { isDeniedPath } from "./bridge-core.mjs";

// Native Git CLI for frequent read-only queries. Persistent process sessions remain in DC.
const MAX_OUTPUT_BYTES = 12000;
function workspaceCwd(root, value) {
  const base = fs.realpathSync.native(root);
  const candidate = fs.realpathSync.native(path.resolve(base, value || "."));
  const relative = path.relative(base, candidate);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative) || isDeniedPath(relative)) {
    throw new Error("Git cwd must stay inside the workspace");
  }
  return candidate;
}
function pathSpec(cwd, requested) {
  if (!requested) return ".";
  const target = path.resolve(cwd, requested);
  const relative = path.relative(cwd, target);
  if (!relative || relative === ".") return ".";
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative) || isDeniedPath(relative)) {
    throw new Error("Git diff path must stay inside the chosen repository");
  }
  let ancestor=target;
  while (!fs.existsSync(ancestor)) {
    const parent=path.dirname(ancestor);
    if (parent===ancestor) break;
    ancestor=parent;
  }
  const real = fs.realpathSync.native(ancestor);
  const realRelative = path.relative(cwd, real);
  if (realRelative === ".." || realRelative.startsWith(".." + path.sep) || path.isAbsolute(realRelative)) {
    throw new Error("Git diff path resolves outside repository");
  }
  return relative.replaceAll("\\","/");
}
export async function nativeGit(root, args={}) {
  const cwd=workspaceCwd(root,args.cwd);
  if (!["status","diff"].includes(args.operation)) throw new Error("Git operation must be status or diff");
  const command = args.operation==="status"
    ? ["--no-optional-locks","status","--short","--branch"]
    : ["--no-optional-locks","diff","--",pathSpec(cwd,args.path)];
  return await new Promise((resolve,reject)=>{
    const child=spawn("git.exe",command,{cwd,windowsHide:true,stdio:["ignore","pipe","pipe"]});
    let stdout="",stderr="",total=0,cut=false,settled=false;
    const timer=setTimeout(()=>{cut=true;child.kill();},12000);
    const collect=(which,chunk)=>{
      const data=chunk.toString("utf8");
      total+=Buffer.byteLength(data);
      if(which==="stderr")stderr=(stderr+data).slice(-3000);
      else stdout=(stdout+data).slice(0,MAX_OUTPUT_BYTES);
      if(total>2*1024*1024){cut=true;child.kill();}
    };
    child.stdout.on("data",ch=>collect("stdout",ch));
    child.stderr.on("data",ch=>collect("stderr",ch));
    child.once("error",err=>{if(settled)return;settled=true;clearTimeout(timer);reject(err);});
    child.once("close",code=>{
      if(settled)return;settled=true;clearTimeout(timer);
      resolve({
        ok:code===0&&!cut,
        operation:"git."+args.operation,
        output:stdout,
        exit_code:code,
        truncated:total>MAX_OUTPUT_BYTES,
        backend:"native_git",
        metadata:{cwd,argv:command,output_bytes:total,...(cut?{timeout_or_budget:true}:{})},
        ...(code===0&&!cut?{}:{failure:cut?"timeout_or_budget":"exit_nonzero",reason:stderr.slice(-1200)})
      });
    });
  });
}
