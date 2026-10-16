#!/usr/bin/env node
/** Direct upgraded Mouse Hole stdio surface; no HTTP execution Runtime. */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { DEFAULT_WORKSPACE, isDeniedPath } from "./bridge-core.mjs";
import { closeComputerAdapter } from "./computer-adapter.mjs";
import { MOUSE_HOLE_TOOLS, mouseHoleCoreCall, mouseHoleConstructionContext } from "./mouse-hole-core.mjs";
import { MICE_HOLE_VERSION } from "./mouse-hole-project-memory.mjs";
import { closeBrowserSessions } from "./browser-cdp.mjs";
import { runBatch } from "../../tools/mouse-hole/bounded-batch.mjs";
import { describeConstructionState, isConstructionTrackingActive, loadConstructionState } from "./mouse-hole-construction-state.mjs";
import { serializeBoundedResponse } from "./mouse-hole-response-budget.mjs";
import { MOUSE_HOLE_SCHEMA_FINGERPRINT } from "./mouse-hole-core.mjs";

const ROOT = process.env.MOUSE_HOLE_WORKSPACE || process.env.HANAKO_WORKSPACE || DEFAULT_WORKSPACE;
const SERVER = { name: "mouse-hole", version: MICE_HOLE_VERSION };
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-11-25"];
process.env.MOUSE_HOLE_SAFE_RETRY = "1";
const healthFile = path.join(ROOT, "work", "mouse-hole", "logs", `mcp-session-${process.pid}.json`);
const sessionHealth = { pid: process.pid, parent_pid: process.ppid, started_at: new Date().toISOString(), server_version: MICE_HOLE_VERSION, execution_mode: "direct_stdio", schema_fingerprint: MOUSE_HOLE_SCHEMA_FINGERPRINT, initialized: false, last_tool_at: null, last_tool_ok: null, response_limited: false, client_receipt_verified: false };
function writeSessionHealth() {
  if (process.env.MOUSE_HOLE_DIAGNOSTIC_PROBE === "1") return;
  try {
    fs.mkdirSync(path.dirname(healthFile), { recursive: true });
    const temporary = `${healthFile}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(sessionHealth));
    fs.renameSync(temporary, healthFile);
  } catch { process.stderr.write("Mouse Hole diagnostic receipt write failed\n"); }
}
writeSessionHealth();

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


async function directCall(name, args) {
    const started = performance.now();
    // Pin execution bookkeeping to the project selected at call start. A parallel
    // project switch cannot attach this call's completion to another project.
    const callContext = { ...mouseHoleConstructionContext };
    if (name === "mouse_hole_process" && Number.isInteger(args.process_id)) {
      for (const [project, execution] of callContext.projects) if (execution.active_processes?.includes(args.process_id)) callContext.project_root = project;
    }
    if (args.cwd) {
      const scoped = loadConstructionState(ROOT, callContext, { cwd: args.cwd });
      if (scoped.project_root) callContext.project_root = scoped.project_root;
    }
    const batchPath=boundedBatchManifest(name,args);
    const lock=batchPath ? "batch:workspace" : resourceKey(name,args);
    const ordinaryCommand=name==="mouse_hole_run" && !batchPath;
    const lockBusy = (!!lock && (activeResources.has(lock) ||
      (lock === "gui:foreground" && [...activeResources].some(key => key.startsWith("gui:"))) ||
      (lock.startsWith("gui:window:") && activeResources.has("gui:foreground")))) ||
      (batchPath && (activeBoundedCommands>0 || [...activeResources].some(key=>key.startsWith("file:")))) ||
      ((ordinaryCommand || (lock && lock.startsWith("file:"))) && activeResources.has("batch:workspace"));
    if (lockBusy) {
      return {ok:false,operation:name,failure:"resource_busy",reason:"Another operation owns this file or foreground GUI resource; retry after it finishes",retryable:true};
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
        result.metadata = { ...(result.metadata || {}), direct_execution_ms: Math.round((performance.now() - started) * 100) / 100 };
      }
      let construction = result?.construction && typeof result.construction === "object" ? result.construction : loadConstructionState(ROOT, callContext);
      // A process handle is transient execution bookkeeping, NOT a project milestone.
      // Never persist a generic wait/continue step to STATUS, TODO or LOG merely
      // because a tool launched/observed a child process.
      if (name === "mouse_hole_process" && isConstructionTrackingActive(construction) && construction.project_root) {
        const project = construction.project_root;
        const execution = callContext.projects.get(project) ?? { active_processes: [] };
        const tracked = Array.isArray(execution.active_processes) ? execution.active_processes : [];
        const processId = args.operation === "start" ? result?.process_id : args.process_id;
        if (Number.isInteger(processId)) {
          if (args.operation === "start" && result?.running === true) {
            execution.active_processes = [...new Set([...tracked, processId])];
            execution.last_action = { tool: name, operation: "start", process_id: processId };
          } else if (["wait", "status", "output", "stop"].includes(args.operation)) {
            const terminal = args.operation === "stop" || result?.metadata?.terminal === true
              || result?.running === false || result?.exit_code !== undefined;
            if (terminal) execution.active_processes = tracked.filter(id => id !== processId);
            execution.last_result = { tool: name, operation: args.operation,
              process_id: processId, terminal, exit_code: result?.exit_code ?? null };
          }
          callContext.projects.set(project, execution);
        }
      }
      if (name === "mouse_hole_status" && (args.detail || "runtime") === "runtime") {
        result.execution = { mode: "direct_stdio", pid: process.pid, runtime_required: false, uptime_seconds: Math.round(process.uptime()) };
        result.session = { id: `mcp-${process.pid}`, state: 'CONNECTED', started_at: sessionHealth.started_at, durable_project_memory: false };
        const current = describeConstructionState(construction);
        result.construction = {
          session_id: current.session_id,
          project: current.project,
          project_root: current.project_root,
          project_status: current.project_status,
          state: current.state,
          current_phase: current.current_phase,
          current_step: current.current_step,
          next_action: current.next_action,
          active_processes: Array.isArray(current.active_processes) ? current.active_processes : [],
          needs_project: current.needs_project ?? false,
          projects: current.projects,
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
      // Preserve typed execution failures in the original MCP result contract.
      return result;
    } finally {
      if (lock) activeResources.delete(lock);
      if (ordinaryCommand) activeBoundedCommands--;
    }
}

function send(message) {
  const bounded = serializeBoundedResponse(message);
  if (bounded.limited) { sessionHealth.response_limited = true; writeSessionHealth(); }
  process.stdout.write(`${bounded.text}\n`, () => {
    sessionHealth.last_stdio_write_at = new Date().toISOString();
    sessionHealth.last_response_bytes = bounded.bytes;
    sessionHealth.last_response_limited = bounded.limited;
    writeSessionHealth();
  });
}
function ok(id, result) { return { jsonrpc: "2.0", id, result }; }
function error(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }

function validateValue(value, schema, label) {
  const allowed = new Set(["type", "properties", "required", "additionalProperties", "enum", "minimum", "maximum", "maxItems", "items", "uniqueItems", "maxLength"]);
  for (const key of Object.keys(schema)) if (!allowed.has(key)) throw new Error(`Unsupported schema keyword at ${label}: ${key}`);
  const type = schema.type;
  const validType = type === "object" ? value !== null && typeof value === "object" && !Array.isArray(value)
    : type === "array" ? Array.isArray(value)
    : type === "integer" ? Number.isInteger(value)
    : type === "number" ? typeof value === "number" && Number.isFinite(value)
    : type === "string" ? typeof value === "string"
    : type === "boolean" ? typeof value === "boolean"
    : true;
  if (!validType) throw new Error(`${label} must be ${type || "a valid value"}`);
  if (schema.enum && !schema.enum.some(item => Object.is(item, value))) throw new Error(`${label} must be one of: ${schema.enum.join(", ")}`);
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) throw new Error(`${label} must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) throw new Error(`${label} must be at most ${schema.maximum}`);
  }
  if (typeof value === "string" && schema.maxLength !== undefined && value.length > schema.maxLength) throw new Error(`${label} must be at most ${schema.maxLength} characters`);
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new Error(`${label} must contain at most ${schema.maxItems} items`);
    if (schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) throw new Error(`${label} items must be unique`);
    if (schema.items) value.forEach((item, index) => validateValue(item, schema.items, `${label}[${index}]`));
  }
  if (type === "object") {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) throw new Error(`${label}.${key} is required`);
    for (const [key, item] of Object.entries(value)) {
      const child = schema.properties?.[key];
      if (!child && schema.additionalProperties === false) throw new Error(`${label}.${key} is not allowed`);
      if (child) validateValue(item, child, `${label}.${key}`);
    }
  }
}

function validateSchemaDefinition(schema, label) {
  const allowed = new Set(["type", "properties", "required", "additionalProperties", "enum", "minimum", "maximum", "maxItems", "items", "uniqueItems", "maxLength"]);
  for (const key of Object.keys(schema)) {
    if (!allowed.has(key)) throw new Error(`Unsupported schema keyword at ${label}: ${key}`);
    if (key === "properties") for (const [name, child] of Object.entries(schema.properties)) validateSchemaDefinition(child, `${label}.${name}`);
    if (key === "items") validateSchemaDefinition(schema.items, `${label}[]`);
  }
}

for (const tool of MOUSE_HOLE_TOOLS) {
  validateSchemaDefinition(tool.inputSchema, `${tool.name}.inputSchema`);
  if (tool.outputSchema) validateSchemaDefinition(tool.outputSchema, `${tool.name}.outputSchema`);
}

async function handle(message) {
  const { id, method, params = {} } = message || {};
  if (method === "initialize") return ok(id, {
    protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : SUPPORTED_PROTOCOL_VERSIONS.at(-1),
    capabilities: { tools: {} }, serverInfo: SERVER,
    instructions: 'Read the configured workspace AGENTS.md and selected project AGENTS.md if present and not already loaded; resume from the authoritative project STATUS or construction://continue. Read optional _system/MD_SESSION_POLICY.md only when needed. Selective reads, milestone-only writes; do not require all four project-memory files for every project. For @micehole continue or 继续施工, recover the current project via mouse_hole_read construction://continue, or include ?project=<workspace-relative path>. Reactivate with mouse_hole_write construction://continue and then carry out the authorized next action. Project memory lives in PROJECT.md, STATUS.md, TODO.md and LOG.md. A connection is not the project lifetime. Never guess among multiple projects or bypass a human gate.',
  });
  if (method === "notifications/initialized") { sessionHealth.initialized = true; writeSessionHealth(); return null; }
  if (method === "notifications/cancelled") return null;
  if (method === "ping") return ok(id, {});
  if (method === "tools/list") return ok(id, { tools: MOUSE_HOLE_TOOLS });
  if (method === "tools/call") {
    const name = String(params.name || "");
    const tool = MOUSE_HOLE_TOOLS.find(item => item.name === name);
    if (!tool) return error(id, -32602, `Unknown Mouse Hole tool: ${name}`);
    if (params.arguments !== undefined && (!params.arguments || typeof params.arguments !== "object" || Array.isArray(params.arguments))) return error(id, -32602, "tools/call arguments must be an object");
    try { validateValue(params.arguments ?? {}, tool.inputSchema, name); }
    catch (cause) { return error(id, -32602, `Invalid arguments for ${name}: ${cause.message}`); }
    try {
      const payload = await directCall(name, params.arguments || {});
      sessionHealth.last_tool_at = new Date().toISOString();
      sessionHealth.last_tool_ok = payload?.ok !== false;
      sessionHealth.last_tool = name;
      writeSessionHealth();
      const content = { ...(payload || {}) };
      const richContent = content.__mcp_content;
      delete content.__mcp_content;
      if (tool.outputSchema) validateValue(content, tool.outputSchema, `${name}.structuredContent`);
      return ok(id, {
        content: [{ type: "text", text: JSON.stringify(content) }, ...(Array.isArray(richContent) ? richContent : [])],
        ...(tool.outputSchema ? { structuredContent: content } : {}),
        isError: payload?.ok === false,
      });
    } catch (cause) {
      sessionHealth.last_tool_at = new Date().toISOString();
      sessionHealth.last_tool_ok = false;
      sessionHealth.last_tool = name;
      writeSessionHealth();
      const reason = String(cause?.message || cause).slice(0, 400);
      const unknown = cause?.code === "execution_unknown";
      const payload = { ok: false, operation: name.replace("mouse_hole_", ""), failure: cause?.code || "backend_error", reason, retryable: !unknown, hint: unknown ? "Inspect the file/process/application state before deciding whether to retry; execution may already have occurred." : "Check the operation inputs and local application/backend availability, then retry if the cause is transient." };
      return ok(id, { content: [{ type: "text", text: JSON.stringify(payload) }], isError: true });
    }
  }
  if (method === "resources/list") return ok(id, { resources: [] });
  if (method === "prompts/list") return ok(id, { prompts: [] });
  if (id === undefined) return null;
  return error(id, -32601, `Method not found: ${method}`);
}

const input = readline.createInterface({ input: process.stdin, terminal: false });
const pending = new Set();
input.on("line", line => {
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); }
  catch { send(error(null, -32700, "Parse error")); return; }
  const work = Promise.resolve(handle(message)).then(response => { if (response) send(response); }).catch(cause => {
    if (message?.id !== undefined) send(error(message.id, -32603, String(cause?.message || cause)));
  });
  pending.add(work);
  work.finally(() => pending.delete(work));
});
input.on("close", async () => {
  sessionHealth.closed_at = new Date().toISOString();
  writeSessionHealth();
  await Promise.allSettled([...pending]);
  await closeBrowserSessions();
  await closeComputerAdapter().catch(cause => process.stderr.write(`Mouse Hole backend close failed: ${cause?.message || cause}\n`));
});
