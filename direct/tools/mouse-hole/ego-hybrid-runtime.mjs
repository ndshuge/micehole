/**
 * Opt-in Ego Windows Host adapter for Mice Hole.
 * The existing Edge CDP tools remain the default. All Ego state updates are
 * serialized across CLI processes because upstream PR #228 caches spaces.json
 * and is not safe for concurrent writes. No personal Edge profile is touched.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

const PROJECT = path.resolve(import.meta.dirname, "../..");
const HOST = process.env.MOUSE_HOLE_EGO_HOST_DIR ||
  path.join(PROJECT, "work", "ego-lite-pilot", "windows-host", "package", "ego-windows-host");
const STATE = process.env.MOUSE_HOLE_EGO_STATE_DIR ||
  path.join(PROJECT, "work", "mouse-hole", "ego-hybrid-runtime");
const LOCK = path.join(STATE, ".ego-state-writer.lock");
const ENTRY = path.join(HOST, "bin", "ego-windows-host.mjs");
const PORT = process.env.MOUSE_HOLE_EGO_CDP_PORT || "19542";
const nap = ms => new Promise(r => setTimeout(r, ms));
const expires = 25000;

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e?.code === "EPERM"; }
}
async function lockState(waitMs = expires) {
  fs.mkdirSync(STATE, {recursive:true});
  const owner = {pid:process.pid, token:crypto.randomUUID(), started:Date.now()};
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    let created = false;
    try {
      fs.mkdirSync(LOCK);
      created = true;
      fs.writeFileSync(path.join(LOCK, "owner.json"), JSON.stringify(owner), {flag:"wx"});
      return owner;
    } catch (e) {
      if (e?.code !== "EEXIST") {
        // Never remove another process's lock on an unexpected I/O error.
        if (created) try { fs.rmSync(LOCK, {recursive:true, force:true}); } catch {}
        throw e;
      }
    }
    // A crashed CLI may leave the lock. Reap only a dead owner's lock.
    try {
      const st = fs.statSync(LOCK);
      if (Date.now() - st.mtimeMs > 3000) {
        let old = null;
        try { old = JSON.parse(fs.readFileSync(path.join(LOCK, "owner.json"), "utf8")); } catch {}
        if (old?.pid && !isAlive(old.pid) || !old && Date.now() - st.mtimeMs > 15000) {
          const retired = LOCK + ".dead-" + process.pid + "-" + crypto.randomUUID();
          try {
            fs.renameSync(LOCK, retired);
            fs.rmSync(retired, {recursive:true, force:true});
          } catch {}
        }
      }
    } catch {}
    await nap(45);
  }
  throw new Error("ego_state_lock_timeout");
}
function unlockState(owner) {
  try {
    const current = JSON.parse(fs.readFileSync(path.join(LOCK, "owner.json"), "utf8"));
    if (current.pid !== owner.pid || current.token !== owner.token)
      throw new Error("ego_state_lock_ownership_lost");
    fs.rmSync(LOCK, {recursive:true, force:true});
  } catch (e) {
    if (e?.code !== "ENOENT") throw e;
  }
}
function runProcess(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const env = {...process.env, EGO_HOST_HEADLESS:"1", EGO_HOST_DEBUG_PORT:PORT, EGO_HOST_STATE_DIR:STATE,
      EGO_HOST_BROWSER_PATH:process.env.MOUSE_HOLE_EGO_EDGE_BIN ||
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"};
    const child = spawn(process.execPath, [ENTRY, ...args], {
      cwd: HOST, windowsHide: true, stdio:["ignore","pipe","pipe"], env,
    });
    let stdout = "", stderr = "", timedOut = false, resolved = false;
    const finish = result => {if(!resolved){resolved=true;resolve(result)}};
    const timer = setTimeout(() => {timedOut = true; child.kill();}, timeoutMs);
    child.stdout.on("data", d => {if(stdout.length < 140000)stdout += d.toString()});
    child.stderr.on("data", d => {if(stderr.length < 12000)stderr += d.toString()});
    child.on("error", e => {clearTimeout(timer); reject(e)});
    child.on("close", code => {clearTimeout(timer); finish({ok:code===0&&!timedOut, exit_code:code, timeout:timedOut, stdout, stderr})});
  });
}
export function egoAvailable() {
  return fs.existsSync(ENTRY) && fs.existsSync(path.join(HOST, "dist", "src", "cli.js"));
}
export async function egoTask({operation="snapshot", url, space="mh-default", maxChars=12000, timeoutMs=18000}={}) {
  if (!egoAvailable()) return {ok:false,operation,error:"ego_not_installed"};
  if (!["snapshot","doctor","close"].includes(operation))throw Error("ego_invalid_operation");
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(space))throw Error("ego_invalid_space_name");
  const bounded = Math.min(Math.max(Number(maxChars)||12000, 1000), 60000);
  if (operation==="snapshot") {
    const parsed = new URL(String(url || ""));
    if (!["https:","http:"].includes(parsed.protocol) || parsed.username || parsed.password)
      throw Error("ego_invalid_url");
  }
  const script = operation==="snapshot" ?
    "await taskSpaces.useOrCreate(" + JSON.stringify("mh-"+space) +
    ");await browser.openOrReuseTab(" + JSON.stringify(url) +
    ",{wait:true});console.log((await page.snapshot()).slice(0,"+bounded+"))" : operation==="close" ?
    "console.log(JSON.stringify(await taskSpaces.complete("+JSON.stringify("mh-"+space)+",{keep:false})))" : null;
  const started = performance.now();
  const owner = await lockState();
  try {
    const result = await runProcess(operation==="doctor" ? ["--doctor"] : ["-e",script], timeoutMs);
    return {...result, operation, backend:"ego_windows_host",
      duration_ms:Math.round(performance.now()-started), state_dir:STATE};
  } finally { unlockState(owner) }
}
