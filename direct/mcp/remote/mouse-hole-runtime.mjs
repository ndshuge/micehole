#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { mouseHoleCoreCall, MOUSE_HOLE_SCHEMA_FINGERPRINT } from "./mouse-hole-core.mjs";
import { DEFAULT_WORKSPACE, isDeniedPath } from "./bridge-core.mjs";
import { runBatch } from "../../tools/mouse-hole/bounded-batch.mjs";
import { describeConstructionState, isConstructionTrackingActive, loadConstructionState, patchConstructionState } from "./mouse-hole-construction-state.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.MOUSE_HOLE_RUNTIME_PORT || 8792);
const ROOT = process.env.MOUSE_HOLE_WORKSPACE || process.env.HANAKO_WORKSPACE || DEFAULT_WORKSPACE;
const SERVER = { name: "mouse-hole-runtime", version: "0.3.0" };
const MAX_BODY = 2 * 1024 * 1024;
// No Agent/queue: independent resources may run concurrently; conflicting writers fail fast.
const activeResources = new Set();
let activeBoundedCommands = 0;
function boundedBatchManifest(name,args) {
  if(name!=="mouse_hole_run" || typeof args.command!=="string" || !args.command.startsWith("mh-batch "))return null;
  const match=/^mh-batch --manifest "([^"\r\n]{1,2048})"$/.exec(args.command);
  if(!match)throw new Error("Invalid bounded in-process batch syntax");
  const base=fs.realpathSync.native(ROOT);
  const real=fs.realpathSync.native(path.resolve(base,match[1]));
  const relative=path.relative(base,real);
  if(relative===".."||relative.startsWith(".."+path.sep)||path.isAbsolute(relative)||isDeniedPath(relative))throw new Error("Batch manifest outside allowed workspace");
  if(!fs.statSync(real).isFile()||fs.statSync(real).size>128*1024)throw new Error("Batch manifest too large or invalid");
  return real;
}
function resourceKey(name,args) {
  if (name === "mouse_hole_gui" && !["status","wait"].includes(args.operation)) {
    if (args.operation === "click" && typeof args.title === "string" && args.title.trim() &&
        typeof args.text === "string" && args.text.trim()) return "gui:window:" + args.title.trim().toLowerCase();
    return "gui:foreground";
  }
  if (["mouse_hole_write","mouse_hole_patch"].includes(name) && typeof args.path === "string") {
    return args.path.startsWith("construction://") ? "construction:state" : "file:" + path.resolve(ROOT,args.path).toLowerCase();
  }
  return null;
}
let constructionState = loadConstructionState(ROOT);

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

async function bodyJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("request body too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return send(res, 200, {
        ok: true,
        server: SERVER,
        workspace: ROOT,
        pid: process.pid,
        uptime_seconds: Math.round(process.uptime()),
      });
    }
    if (req.method === "GET" && req.url === "/construction/state") {
      return send(res, 200, { ok: true, state: describeConstructionState(constructionState) });
    }
    if (req.method === "POST" && req.url === "/construction/state") {
      const request = await bodyJson(req);
      constructionState = patchConstructionState(ROOT, request?.patch && typeof request.patch === "object" ? request.patch : {});
      return send(res, 200, { ok: true, state: describeConstructionState(constructionState) });
    }
    if (req.method !== "POST" || req.url !== "/call") {
      return send(res, 404, { ok: false, error: "not_found" });
    }
    const request = await bodyJson(req);
    const name = String(request?.name || "");
    const args = request?.args && typeof request.args === "object" && !Array.isArray(request.args) ? request.args : {};
    if (!name.startsWith("mouse_hole_")) return send(res, 400, { ok: false, error: "invalid_tool" });
    const started = performance.now();
    const batchPath=boundedBatchManifest(name,args);
    const lock=batchPath ? "batch:workspace" : resourceKey(name,args);
    const ordinaryCommand=name==="mouse_hole_run" && !batchPath;
    const lockBusy = (!!lock && (activeResources.has(lock) ||
      (lock === "gui:foreground" && [...activeResources].some(key => key.startsWith("gui:"))) ||
      (lock.startsWith("gui:window:") && activeResources.has("gui:foreground")))) ||
      (batchPath && (activeBoundedCommands>0 || [...activeResources].some(key=>key.startsWith("file:")))) ||
      ((ordinaryCommand || (lock && lock.startsWith("file:"))) && activeResources.has("batch:workspace"));
    if (lockBusy) {
      return send(res, 200, {ok:true,result:{ok:false,operation:name,failure:"resource_busy",reason:"Another operation owns this file or foreground GUI resource; retry after it finishes",retryable:true}});
    }
    if (lock) activeResources.add(lock);
    if (ordinaryCommand) activeBoundedCommands++;
    try {
      const stageResult=batchPath ? await runBatch(JSON.parse(fs.readFileSync(batchPath,"utf8"))) : null;
      const result = stageResult ? {
        ok:stageResult.ok,operation:"run",
        output:"MOUSE_HOLE_BATCH "+JSON.stringify(stageResult),
        metadata:{executor:"inprocess_batch",steps:stageResult.count,groups:stageResult.groups_executed,duration_ms:stageResult.elapsed_ms},
        ...(!stageResult.ok?{failure:"batch_failed",reason:"A stage failed and later stages were not executed"}:{})
      } : await mouseHoleCoreCall(ROOT, name, args);
      if (result && typeof result === "object") {
        result.metadata = { ...(result.metadata || {}), runtime_execution_ms: Math.round((performance.now() - started) * 100) / 100 };
      }
      let construction = result?.construction && typeof result.construction === "object" ? result.construction : constructionState;
      constructionState = construction;
      if (name === "mouse_hole_process" && args.operation === "start" && Number.isInteger(result?.process_id) && isConstructionTrackingActive(construction)) {
        construction = patchConstructionState(ROOT, {
          state: "WAITING_PROCESS",
          active_processes: [...construction.active_processes, result.process_id],
          last_action: { tool: name, operation: "start", process_id: result.process_id },
          next_action: "wait_for_process",
        });
        constructionState = construction;
      }
      if (name === "mouse_hole_process" && args.operation === "wait" && isConstructionTrackingActive(construction)) {
        const terminal = result?.metadata?.terminal === true || result?.exit_code !== undefined;
        construction = patchConstructionState(ROOT, {
          state: terminal ? "RUNNING" : "WAITING_PROCESS",
          active_processes: terminal ? construction.active_processes.filter(id => id !== args.process_id) : construction.active_processes,
          last_result: { tool: name, operation: "wait", process_id: args.process_id, terminal, exit_code: result?.exit_code ?? null },
          next_action: terminal ? "continue_plan" : "wait_for_process",
        });
        constructionState = construction;
      }
      if (name === "mouse_hole_process" && ["status", "output", "stop"].includes(args.operation) && isConstructionTrackingActive(construction) && Number.isInteger(args.process_id)) {
        const terminal = args.operation === "stop" || result?.running === false || result?.exit_code !== undefined;
        if (terminal && construction.active_processes.includes(args.process_id)) {
          const activeProcesses = construction.active_processes.filter(id => id !== args.process_id);
          construction = patchConstructionState(ROOT, {
            state: activeProcesses.length ? "WAITING_PROCESS" : "RUNNING",
            active_processes: activeProcesses,
            last_result: { tool: name, operation: args.operation, process_id: args.process_id, terminal: true, exit_code: result?.exit_code ?? null },
            next_action: activeProcesses.length ? "wait_for_process" : "continue_plan",
          });
          constructionState = construction;
        }
      }
      if (name === "mouse_hole_status" && (args.detail || "runtime") === "runtime") {
        result.runtime = { pid: process.pid, host: HOST, port: PORT, version: SERVER.version, schema_fingerprint: MOUSE_HOLE_SCHEMA_FINGERPRINT, uptime_seconds: Math.round(process.uptime()) };
        const current = describeConstructionState(construction);
        result.construction = {
          session_id: current.session_id,
          state: current.state,
          current_phase: current.current_phase,
          current_step: current.current_step,
          next_action: current.next_action,
          active_processes: Array.isArray(current.active_processes) ? current.active_processes : [],
        };
      }
      const continuity = describeConstructionState(construction);
      if (continuity.continuation_due && isConstructionTrackingActive(continuity)) {
        result.continuity = {
          continuation_due: true,
          session_id: continuity.session_id,
          segment_number: continuity.segment_number,
          lease_seconds: continuity.lease_seconds,
          checkpoint_hint: "Checkpoint the current milestone before starting another long operation.",
        };
      }
      // A valid tool call with ok:false is still a successful MCP transport round trip.
      // Preserve the typed failure so the caller sees the real reason, not a generic HTTP 422.
      return send(res, 200, { ok: true, result });
    } catch (cause) {
      const message = String(cause?.message || cause).slice(0, 2000);
      return send(res, 500, { ok: false, error: cause?.code || "runtime_error", message });
    } finally {
      if (lock) activeResources.delete(lock);
      if (ordinaryCommand) activeBoundedCommands--;
    }
  } catch (cause) {
    return send(res, 400, { ok: false, error: "bad_request", message: String(cause?.message || cause).slice(0, 1000) });
  }
});

server.listen(PORT, HOST, () => {
  process.stderr.write(JSON.stringify({ ok: true, event: "runtime_listening", host: HOST, port: PORT, pid: process.pid, workspace: ROOT }) + "\n");
});

function shutdown(signal) {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
