import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { computerCall } from "./computer-adapter.mjs";
import { isDeniedPath } from "./bridge-core.mjs";
import { adapterCommand, adapterRepoCwd, runAdapterSync, writeAdapterPayload } from "./python-adapter-bridge.mjs";
import { createJob, getJob, updateJob } from "./job-core.mjs";

function schema(properties, required = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

function annotations(readOnlyHint, destructiveHint = false) {
  return { readOnlyHint, destructiveHint, openWorldHint: false };
}

const taskId = { type: "string", description: "Optional current Hanako task id for continuation context" };

export const VNEXT_TOOLS = [
  {
    name: "hanako_write",
    description: "vNext workspace file write. Compatibility wrapper over the proven Legacy v1 write path.",
    inputSchema: schema({ path: { type: "string" }, content: { type: "string" }, expected_sha256: { type: "string" }, task_id: taskId }, ["path", "content"]),
    annotations: annotations(false, true),
  },
  {
    name: "hanako_patch",
    description: "vNext surgical workspace text patch with an expected replacement count.",
    inputSchema: schema({ path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" }, expected_replacements: { type: "integer", minimum: 1 }, expected_sha256: { type: "string" }, task_id: taskId }, ["path", "old_string", "new_string"]),
    annotations: annotations(false, true),
  },
  {
    name: "hanako_run",
    description: "vNext generic command escape hatch. Prefer typed application capabilities for recurring workflows.",
    inputSchema: schema({ command: { type: "string" }, cwd: { type: "string" }, timeout_ms: { type: "integer", minimum: 1 }, task_id: taskId }, ["command"]),
    annotations: annotations(false, true),
  },
  {
    name: "hanako_process_start",
    description: "Start a Hanako-managed persistent process session.",
    inputSchema: schema({ command: { type: "string" }, cwd: { type: "string" }, timeout_ms: { type: "integer", minimum: 1 }, task_id: taskId }, ["command"]),
    annotations: annotations(false, true),
  },
  {
    name: "hanako_process_stop",
    description: "Stop a Hanako-managed process session. This is not an arbitrary system PID kill surface.",
    inputSchema: schema({ process_id: { type: "integer" }, task_id: taskId }, ["process_id"]),
    annotations: annotations(false, true),
  },
  {
    name: "hanako_ops",
    description: "Typed Hanako self-operations. Only fixed allowlisted maintenance targets are accepted.",
    inputSchema: schema({
      operation: { type: "string", enum: ["status_detail", "restart_component"] },
      component: { type: "string", enum: ["supervisor", "b2-consumer", "tunnel"] },
      task_id: taskId,
    }, ["operation"]),
    annotations: annotations(false, true),
  },
  {
    name: "hanako_observe",
    description: "Read-only visual/resource observation. Separates seeing from GUI actuation.",
    inputSchema: schema({
      target: { type: "string", enum: ["screen", "window", "image", "resource"] },
      title: { type: "string" },
      path: { type: "string" },
      task_id: taskId,
    }, ["target"]),
    annotations: annotations(true, false),
  },
  {
    name: "hanako_blender",
    description: "Typed Blender v1 operations backed by Blender background mode and bpy.",
    inputSchema: schema({
      operation: { type: "string", enum: ["status", "inspect_blend", "mesh_stats", "inspect_glb", "export_glb"] },
      blend: { type: "string" },
      glb: { type: "string" },
      output: { type: "string" },
      task_id: taskId,
    }, ["operation"]),
    annotations: annotations(false, true),
  },
  {
    name: "hanako_comfyui",
    description: "Typed ComfyUI v1 operations backed by the native HTTP API.",
    inputSchema: schema({
      operation: { type: "string", enum: ["status", "queue_status", "workflow_validate", "models_list", "queue_submit"] },
      workflow: { type: "object", additionalProperties: true },
      client_id: { type: "string" },
      task_id: taskId,
    }, ["operation"]),
    annotations: annotations(false, true),
  },
  {
    name: "hanako_3d",
    description: "Typed 3D generation operations. TripoSR is the first backend.",
    inputSchema: schema({
      operation: { type: "string", enum: ["status", "backend_status", "generate_from_image", "job_status", "cancel_job"] },
      backend: { type: "string", enum: ["triposr"] },
      image: { type: "string" },
      output_dir: { type: "string" },
      device: { type: "string" },
      format: { type: "string", enum: ["glb", "obj"] },
      mc_resolution: { type: "integer", minimum: 64, maximum: 512 },
      chunk_size: { type: "integer", minimum: 0 },
      no_remove_bg: { type: "boolean" },
      job_id: { type: "string" },
      task_id: taskId,
    }, ["operation"]),
    annotations: annotations(false, true),
  },
];

const LEGACY_ALIAS = new Map([
  ["hanako_run", "hanako_run_command"],
  ["hanako_process_start", "hanako_start_process"],
]);

const DURABLE = new Set([
  "blender:export_glb",
  "3d:generate_from_image",
]);

function cleanPayload(args) {
  const payload = { ...args };
  delete payload.operation;
  delete payload.task_id;
  delete payload.backend;
  return payload;
}

function workspacePath(root, value) {
  const base = fs.realpathSync.native(root);
  const abs = path.resolve(path.isAbsolute(value) ? value : path.join(base, value));
  const real = fs.realpathSync.native(abs);
  const rel = path.relative(base, real);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error("Path must remain inside the Hanako workspace");
  if (isDeniedPath(rel)) throw new Error("Credential-like path is unavailable");
  return real;
}

function conflictCheck(root, args) {
  if (!args.expected_sha256) return null;
  const file = workspacePath(root, args.path);
  const actual = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const expected = String(args.expected_sha256).toLowerCase();
  if (actual.toLowerCase() === expected) return null;
  return { ok: false, state: "failed", error_class: "conflict", summary: "File changed since it was read; write refused", path: file, expected_sha256: expected, actual_sha256: actual };
}

function parseAdapterResult(output) {
  const lines = String(output || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].startsWith("{")) continue;
    try {
      const value = JSON.parse(lines[i]);
      if (value && typeof value === "object" && value.state) return value;
    } catch {}
  }
  return null;
}

async function refreshJob(root, job) {
  if (!job || job.state !== "RUNNING" || !job.process_id) return job;
  try {
    const processResult = await computerCall(root, "hanako_process_output", { process_id: job.process_id, timeout_ms: 100, offset: 0, length: 500 });
    const adapterResult = parseAdapterResult(processResult.output);
    if (adapterResult) {
      const changes = {
        summary: adapterResult.summary || job.summary,
        artifacts: Array.isArray(adapterResult.artifact_refs) ? adapterResult.artifact_refs : job.artifacts,
        error_class: adapterResult.error_class || null,
        validation: adapterResult.validation || null,
        adapter_metrics: adapterResult.metrics || {},
      };
      if (adapterResult.state === "succeeded") changes.state = "SUCCEEDED";
      if (adapterResult.state === "failed") changes.state = "FAILED";
      if (adapterResult.state === "cancelled") changes.state = "CANCELLED";
      if (changes.state) changes.finished_at = new Date().toISOString();
      job = updateJob(root, job.job_id, changes);
    }
  } catch {}
  return getJob(root, job.job_id) || job;
}

async function durableAdapterCall(root, toolName, adapter, operation, args) {
  const resourceClass = adapter === "3d" ? "GPU_HEAVY" : "CPU_HEAVY";
  const job = createJob(root, {
    task_id: args.task_id || null,
    capability: `${adapter}.${operation}`,
    backend: adapter === "3d" ? (args.backend || "triposr") : adapter,
    resource_class: resourceClass,
    state: "QUEUED",
    summary: `${toolName}/${operation} queued`,
  });
  const payload = cleanPayload(args);
  payload.job_id = job.job_id;
  const payloadFile = writeAdapterPayload(root, payload);
  const command = adapterCommand(root, adapter, operation, payloadFile);
  try {
    const started = await computerCall(root, "hanako_start_process", {
      command, cwd: adapterRepoCwd(root), timeout_ms: 1000,
      ...(args.task_id ? { task_id: args.task_id } : {}),
    });
    const running = updateJob(root, job.job_id, {
      state: "RUNNING", process_id: started.process_id, started_at: new Date().toISOString(),
      summary: `${toolName}/${operation} running`,
    });
    return { ok: true, tool: toolName, adapter, operation, execution_mode: "DURABLE", state: "running", job_id: running.job_id, process_id: running.process_id, resource_class: resourceClass };
  } catch (error) {
    updateJob(root, job.job_id, { state: "FAILED", error_class: "backend_bug", finished_at: new Date().toISOString(), summary: String(error?.message || error) });
    try { if (fs.existsSync(payloadFile)) fs.unlinkSync(payloadFile); } catch {}
    throw error;
  }
}

async function appCall(root, toolName, adapter, args) {
  const operation = String(args.operation || "");
  if (toolName === "hanako_3d" && operation === "job_status") {
    if (!args.job_id) throw new Error("job_id is required for job_status");
    let job = getJob(root, args.job_id);
    if (!job || job.backend !== (args.backend || "triposr")) throw new Error("3D job not found");
    job = await refreshJob(root, job);
    return { ok: job.state !== "FAILED", tool: toolName, execution_mode: "DURABLE", state: String(job.state).toLowerCase(), summary: job.summary || "3D job status", job };
  }
  if (toolName === "hanako_3d" && operation === "cancel_job") {
    if (!args.job_id) throw new Error("job_id is required for cancel_job");
    const job = getJob(root, args.job_id);
    if (!job || job.backend !== (args.backend || "triposr")) throw new Error("3D job not found");
    if (job.process_id && !["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.state)) {
      await computerCall(root, "hanako_kill_process", { process_id: job.process_id });
      try { runAdapterSync(root, "3d", "_release_guard", { job_id: job.job_id }, 10000); } catch {}
    }
    const current = getJob(root, job.job_id) || job;
    return { ok: true, tool: toolName, execution_mode: "DURABLE", state: String(current.state).toLowerCase(), summary: "3D job cancelled", job: current };
  }
  if (DURABLE.has(`${adapter}:${operation}`)) return durableAdapterCall(root, toolName, adapter, operation, args);
  const result = runAdapterSync(root, adapter, operation, cleanPayload(args), 30000);
  return { ok: result.state === "succeeded", tool: toolName, adapter, operation, execution_mode: "FAST", ...result };
}

export async function vnextCall(root, name, args = {}) {
  if (name === "hanako_write" || name === "hanako_patch") {
    const conflict = conflictCheck(root, args);
    if (conflict) return conflict;
    const legacy = name === "hanako_write" ? "hanako_write_file" : "hanako_edit_file";
    const forwarded = { ...args };
    delete forwarded.expected_sha256;
    const payload = await computerCall(root, legacy, forwarded);
    return { ...payload, tool: name, compatibility_backend: legacy };
  }

  if (name === "hanako_process_stop") {
    const status = await computerCall(root, "hanako_process_status", { process_id: args.process_id });
    if (!status.running) return { ok: false, state: "failed", error_class: "policy_denied", summary: "process_id is not a Hanako-managed active session", process_id: args.process_id };
    const payload = await computerCall(root, "hanako_kill_process", args);
    return { ...payload, tool: name, compatibility_backend: "hanako_kill_process" };
  }

  const legacy = LEGACY_ALIAS.get(name);
  if (legacy) {
    const payload = await computerCall(root, legacy, args);
    return { ...payload, tool: name, compatibility_backend: legacy };
  }

  if (name === "hanako_ops") {
    let command;
    if (args.operation === "status_detail") command = "hanako maintenance status";
    else if (args.operation === "restart_component") {
      const map = { supervisor: "restart-supervisor", "b2-consumer": "restart-b2-consumer", tunnel: "restart-tunnel" };
      const action = map[args.component];
      if (!action) throw new Error("restart_component requires an allowlisted component");
      command = `hanako maintenance ${action}`;
    } else throw new Error("unknown Hanako operations action");
    const payload = await computerCall(root, "hanako_run_command", { command, ...(args.task_id ? { task_id: args.task_id } : {}) });
    return { ...payload, tool: name, operation: args.operation };
  }

  if (name === "hanako_observe") {
    let virtual;
    if (args.target === "screen") virtual = "screen://primary";
    else if (args.target === "window") {
      if (!args.title) throw new Error("window observation requires title");
      virtual = `window://${args.title}`;
    } else if (args.target === "image") {
      if (!args.path) throw new Error("image observation requires path");
      virtual = `image://${args.path}`;
    } else if (args.target === "resource") {
      if (!args.path) throw new Error("resource observation requires path");
      virtual = `resource://${args.path}`;
    } else throw new Error("unknown observation target");
    const payload = await computerCall(root, "hanako_read_file", { path: virtual, ...(args.task_id ? { task_id: args.task_id } : {}) });
    return { ...payload, tool: name, target: args.target };
  }

  if (name === "hanako_blender") return appCall(root, name, "blender", args);
  if (name === "hanako_comfyui") return appCall(root, name, "comfyui", args);
  if (name === "hanako_3d") return appCall(root, name, "3d", args);
  throw new Error(`Unsupported vNext tool: ${name}`);
}
