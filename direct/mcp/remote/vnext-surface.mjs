/** OpenHanako vNext feature-gated surface.
 *
 * This module contains typed semantic tools that are not exposed unless
 * HANAKO_VNEXT_SURFACE=1. Legacy v1 remains the default deployment surface.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { computerCall } from "./computer-adapter.mjs";
import { isDeniedPath } from "./bridge-core.mjs";
import { createJob, getJob, updateJob } from "./job-core.mjs";
import { acquireHeavyGpu, currentHeavyGpu, releaseHeavyGpu } from "./resource-guard.mjs";
import { fileSha256, getArtifact, recordArtifact } from "./artifact-core.mjs";
import { cacheGet, cachePut, fingerprintStep } from "./cache-core.mjs";
import { createRecipe, getRecipe, updateRecipe, updateStep } from "./recipe-core.mjs";
import { runAdapterSync } from "./python-adapter-bridge.mjs";
import { browserClick, browserDumpDom, browserFill, browserInspect, browserScreenshot, browserType } from "./browser-cdp.mjs";

const BLENDER_BIN = process.env.BLENDER_BIN || "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe";
const COMFYUI_ROOT = process.env.COMFYUI_ROOT || "H:\\AI\\ComfyUI";
const COMFYUI_URL = process.env.COMFYUI_URL || "http://127.0.0.1:8188";
const TRIPOSR_ROOT = process.env.TRIPOSR_ROOT || "D:\\AI\\TripoSR";
const TRIPOSR_PY = process.env.TRIPOSR_PY || path.join(TRIPOSR_ROOT, ".venv", "Scripts", "python.exe");
const TRIPOSR_MODEL = process.env.TRIPOSR_MODEL || path.join(TRIPOSR_ROOT, "models", "TripoSR");
const GUI_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "gui-windows.ps1");
const EDGE_BIN = process.env.EDGE_BIN || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CHROME_BIN = process.env.CHROME_BIN || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BROWSER_BIN = process.env.BROWSER_BIN || (fs.existsSync(EDGE_BIN) ? EDGE_BIN : (fs.existsSync(CHROME_BIN) ? CHROME_BIN : null));

function safeInside(root, value, mustExist = true) {
  const base = fs.realpathSync.native(root);
  const abs = path.resolve(path.isAbsolute(value) ? value : path.join(base, value));
  let check = abs;
  if (!mustExist) {
    while (!fs.existsSync(check)) {
      const parent = path.dirname(check);
      if (parent === check) break;
      check = parent;
    }
  }
  const real = fs.realpathSync.native(check);
  const relReal = path.relative(base, real);
  const rel = path.relative(base, abs);
  if ([relReal, rel].some(x => x === ".." || x.startsWith(`..${path.sep}`) || path.isAbsolute(x))) {
    throw new Error("Path must remain inside the Hanako workspace");
  }
  if (isDeniedPath(relReal) || isDeniedPath(rel)) throw new Error("Credential-like path is unavailable");
  if (mustExist && !fs.existsSync(abs)) throw new Error(`Path does not exist: ${abs}`);
  return abs;
}

function run(executable, args, timeoutMs = 30000) {
  const child = spawnSync(executable, args, {
    encoding: "utf8", windowsHide: true, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024,
  });
  const stdout = child.stdout || "";
  const stderr = child.stderr || "";
  if (child.error) return { ok: false, error_class: child.error.code === "ETIMEDOUT" ? "timeout" : "backend_bug", summary: child.error.message, stdout, stderr };
  if (child.status !== 0) return { ok: false, error_class: "backend_bug", summary: (stderr || stdout || `exit ${child.status}`).slice(0, 2000), stdout, stderr, exit_code: child.status };
  return { ok: true, stdout, stderr, exit_code: child.status ?? 0 };
}

function psQuote(value) { return "'" + String(value).replaceAll("'", "''") + "'"; }

function markerJson(stdout) {
  const line = String(stdout || "").split(/\r?\n/).find(x => x.startsWith("HANAKO_JSON="));
  if (!line) throw new Error("Adapter backend did not emit HANAKO_JSON");
  return JSON.parse(line.slice("HANAKO_JSON=".length));
}

function result(summary, extra = {}) {
  return { ok: true, state: "succeeded", summary, ...extra };
}

function unavailable(summary, extra = {}) {
  return { ok: false, state: "failed", error_class: "unavailable", summary, ...extra };
}

const operationSchema = values => ({ type: "string", enum: values });

export const VNEXT_TOOLS = [
  {
    name: "hanako_ops",
    title: "Hanako operations",
    description: "Typed Hanako lifecycle operations. vNext preview surface.",
    inputSchema: {
      type: "object",
      properties: {
        operation: operationSchema(["status_detail", "restart_component"]),
        component: { type: "string", enum: ["supervisor", "b2-consumer", "tunnel"] },
      },
      required: ["operation"], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  {
    name: "hanako_observe",
    title: "Observe screen or window",
    description: "Read-only visual observation without GUI actuation.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", enum: ["screen", "window", "image", "resource"] },
        title: { type: "string" },
        path: { type: "string" },
      },
      required: ["target"], additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "hanako_gui",
    title: "Foreground GUI fallback",
    description: "Typed foreground Windows mouse/keyboard fallback. Use only when API/CLI/structured automation cannot complete the step.",
    inputSchema: {
      type: "object",
      properties: {
        operation: operationSchema(["status", "wait", "focus_window", "move", "click", "double_click", "right_click", "drag", "scroll", "type_text", "key_press", "hotkey"]),
        foreground_control: { type: "boolean" },
        x: { type: "integer" },
        y: { type: "integer" },
        x2: { type: "integer" },
        y2: { type: "integer" },
        delta: { type: "integer", minimum: -12000, maximum: 12000 },
        text: { type: "string", maxLength: 4000 },
        title: { type: "string", maxLength: 512 },
        key: { type: "string", enum: ["ENTER", "TAB", "ESC", "SPACE", "BACKSPACE", "DELETE", "UP", "DOWN", "LEFT", "RIGHT", "HOME", "END", "PAGEUP", "PAGEDOWN", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12", "A", "C", "V", "X", "Y", "Z"] },
        modifiers: { type: "array", items: { type: "string", enum: ["CTRL", "ALT", "SHIFT"] }, uniqueItems: true, maxItems: 3 },
        duration_ms: { type: "integer", minimum: 0, maximum: 30000 },
      },
      required: ["operation"], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "hanako_browser",
    title: "Structured headless browser",
    description: "Headless Chromium browser operations. Uses structured/background browser execution before GUI fallback.",
    inputSchema: {
      type: "object",
      properties: {
        operation: operationSchema(["status", "dump_dom", "inspect", "click", "fill", "type", "screenshot"]),
        url: { type: "string", maxLength: 4096 },
        selector: { type: "string", maxLength: 2048 },
        text: { type: "string", maxLength: 20000 },
        wait_ms: { type: "integer", minimum: 0, maximum: 30000 },
        output_path: { type: "string" },
        width: { type: "integer", minimum: 320, maximum: 3840 },
        height: { type: "integer", minimum: 240, maximum: 2160 },
        max_chars: { type: "integer", minimum: 1000, maximum: 120000 },
      },
      required: ["operation"], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "hanako_blender",
    title: "Blender adapter",
    description: "Typed Blender inspection operations backed by official Blender CLI/bpy.",
    inputSchema: {
      type: "object",
      properties: {
        operation: operationSchema(["status", "inspect_blend", "mesh_stats", "inspect_glb"]),
        blend_path: { type: "string" },
        glb_path: { type: "string" },
      },
      required: ["operation"], additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "hanako_comfyui",
    title: "ComfyUI adapter",
    description: "Typed ComfyUI status, model inventory and queue inspection.",
    inputSchema: {
      type: "object",
      properties: {
        operation: operationSchema(["status", "models_list", "queue_status", "workflow_validate", "queue_submit", "job_status", "cancel_job", "output_resolve"]),
        category: { type: "string", enum: ["checkpoints", "controlnet", "clip_vision", "ipadapter", "vae", "loras"] },
        workflow: { type: "object", additionalProperties: true },
        client_id: { type: "string" },
        job_id: { type: "string" },
        task_id: { type: "string" },
      },
      required: ["operation"], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "hanako_3d",
    title: "3D generation adapter",
    description: "Typed 3D backend operations. TripoSR is the first configured backend.",
    inputSchema: {
      type: "object",
      properties: {
        operation: operationSchema(["status", "generate_from_image", "job_status", "cancel_job"]),
        backend: { type: "string", enum: ["triposr"] },
        source_image: { type: "string" },
        output_dir: { type: "string" },
        device: { type: "string" },
        mc_resolution: { type: "integer", minimum: 64, maximum: 512 },
        remove_bg: { type: "boolean" },
        job_id: { type: "string" },
        task_id: { type: "string" },
        recipe_id: { type: "string" },
        step_id: { type: "string" },
      },
      required: ["operation"], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "hanako_recipe",
    title: "Run a named resumable Hanako recipe",
    description: "Runs or resumes a bounded named linear recipe using existing adapters; not a generic workflow engine.",
    inputSchema: {
      type: "object",
      properties: {
        operation: operationSchema(["start", "status", "resume"]),
        recipe: { type: "string", enum: ["mouse_asset_validation_v1"] },
        recipe_id: { type: "string" },
        source_image: { type: "string" },
        task_id: { type: "string" },
        device: { type: "string" },
        mc_resolution: { type: "integer", minimum: 64, maximum: 512 },
      },
      required: ["operation"], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
];

async function callOps(root, args) {
  if (args.operation === "status_detail") {
    const out = await computerCall(root, "hanako_run_command", { command: "hanako maintenance status", cwd: root });
    return result("Hanako operations status collected", { maintenance_action: out.maintenance_action || "status", output: out.output });
  }
  if (args.operation === "restart_component") {
    const map = { supervisor: "restart-supervisor", "b2-consumer": "restart-b2-consumer", tunnel: "restart-tunnel" };
    const action = map[args.component];
    if (!action) throw new Error("component is required for restart_component");
    const out = await computerCall(root, "hanako_run_command", { command: `hanako maintenance ${action}`, cwd: root });
    return result(`Restart requested for ${args.component}`, { maintenance_action: out.maintenance_action, output: out.output });
  }
  throw new Error("Unsupported hanako_ops operation");
}

async function callObserve(root, args) {
  let virtualPath;
  if (args.target === "screen") virtualPath = "screen://primary";
  else if (args.target === "window") {
    if (!args.title) throw new Error("title is required for window observation");
    virtualPath = `window://${args.title}`;
  } else if (args.target === "image") {
    if (!args.path) throw new Error("path is required for image observation");
    safeInside(root, args.path);
    virtualPath = `image://${args.path}`;
  } else if (args.target === "resource") {
    if (!args.path) throw new Error("path is required for resource observation");
    safeInside(root, args.path);
    virtualPath = `resource://${args.path}`;
  } else throw new Error("Unsupported observation target");
  return computerCall(root, "hanako_read_file", { path: virtualPath });
}

function guiKeyToken(key, modifiers = []) {
  const plain = new Set(["A", "C", "V", "X", "Y", "Z"]);
  const special = new Set(["ENTER", "TAB", "ESC", "BACKSPACE", "DELETE", "UP", "DOWN", "LEFT", "RIGHT", "HOME", "END", "PAGEUP", "PAGEDOWN", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"]);
  let token;
  if (key === "SPACE") token = " ";
  else if (plain.has(key)) token = key.toLowerCase();
  else if (special.has(key)) token = `{${key}}`;
  else throw new Error("Unsupported GUI key");
  const prefix = [...new Set(modifiers)].map(mod => ({ CTRL: "^", ALT: "%", SHIFT: "+" })[mod]).join("");
  return prefix + token;
}

function callGui(root, args) {
  const operation = args.operation;
  const passive = new Set(["status", "wait"]);
  if (!passive.has(operation) && args.foreground_control !== true) {
    throw new Error("foreground_control=true is required for GUI actuation");
  }
  const psArgs = ["-NoProfile", "-Sta", "-ExecutionPolicy", "Bypass", "-File", GUI_SCRIPT, "-Operation", operation];
  const push = (flag, value) => { if (value !== undefined && value !== null) psArgs.push(flag, String(value)); };
  push("-X", args.x);
  push("-Y", args.y);
  push("-X2", args.x2);
  push("-Y2", args.y2);
  push("-Delta", args.delta);
  push("-Text", args.text);
  push("-Title", args.title);
  push("-DurationMs", args.duration_ms);
  if (operation === "key_press" || operation === "hotkey") {
    if (!args.key) throw new Error("key is required");
    push("-Keys", guiKeyToken(args.key, operation === "hotkey" ? (args.modifiers || []) : []));
  }
  const out = run("powershell.exe", psArgs, operation === "wait" ? Math.min(35000, Number(args.duration_ms || 0) + 5000) : 15000);
  if (!out.ok) return out;
  const line = String(out.stdout || "").trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) throw new Error("GUI backend returned no result");
  const payload = JSON.parse(line);
  return {
    ok: payload.ok === true,
    state: "succeeded",
    summary: operation === "status" ? "GUI state read" : `GUI ${operation} completed`,
    operation,
    gui_state: payload.state || null,
    foreground_required: !passive.has(operation),
  };
}

function browserUrl(value) {
  if (!value) throw new Error("url is required");
  const parsed = new URL(String(value));
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only http/https URLs are supported");
  return parsed.toString();
}

async function callBrowser(root, args) {
  if (args.operation === "status") {
    if (!BROWSER_BIN) return unavailable("No supported Chromium browser found");
    const stat = fs.statSync(BROWSER_BIN);
    return result("Headless browser backend available", {
      executable: BROWSER_BIN,
      executable_size: stat.size,
      headless: true,
      transport: "cdp",
    });
  }
  if (!BROWSER_BIN) return unavailable("No supported Chromium browser found");
  const url = browserUrl(args.url);
  if (args.operation === "dump_dom") {
    const maxChars = Math.max(1000, Math.min(120000, Number(args.max_chars || 30000)));
    const captured = await browserDumpDom({ root, browserBin: BROWSER_BIN, url, maxChars });
    return result("DOM captured with headless CDP browser", {
      url,
      ...captured,
      headless: true,
      transport: "cdp",
    });
  }
  if (["inspect", "click", "fill", "type"].includes(args.operation)) {
    if (!args.selector) throw new Error("selector is required");
    const waitMs = Math.max(0, Math.min(30000, Number(args.wait_ms ?? 5000)));
    let acted;
    if (args.operation === "inspect") acted = await browserInspect({ root, browserBin: BROWSER_BIN, url, selector: args.selector, waitMs });
    if (args.operation === "click") acted = await browserClick({ root, browserBin: BROWSER_BIN, url, selector: args.selector, waitMs });
    if (args.operation === "fill") acted = await browserFill({ root, browserBin: BROWSER_BIN, url, selector: args.selector, text: args.text ?? "", waitMs });
    if (args.operation === "type") acted = await browserType({ root, browserBin: BROWSER_BIN, url, selector: args.selector, text: args.text ?? "", waitMs });
    return result(`Browser ${args.operation} completed with headless CDP`, {
      url, ...acted, headless: true, transport: "cdp",
    });
  }
  if (args.operation === "screenshot") {
    const width = Math.max(320, Math.min(3840, Number(args.width || 1440)));
    const height = Math.max(240, Math.min(2160, Number(args.height || 1000)));
    const outputPath = args.output_path
      ? safeInside(root, args.output_path, false)
      : path.join(root, "work", "bridge", "browser-artifacts", `browser-${Date.now()}.png`);
    const shot = await browserScreenshot({
      root, browserBin: BROWSER_BIN, url, outputPath, width, height,
    });
    const observed = await computerCall(root, "hanako_read_file", { path: `image://${shot.outputPath}` });
    return {
      ...observed,
      ok: true,
      state: "succeeded",
      summary: "Headless CDP browser screenshot captured",
      url,
      path: shot.outputPath,
      size_bytes: shot.size,
      headless: true,
      transport: "cdp",
    };
  }
  throw new Error("Unsupported browser operation");
}

function blenderStatus() {
  if (!fs.existsSync(BLENDER_BIN)) return unavailable("Blender executable not found", { executable: BLENDER_BIN });
  const stat = fs.statSync(BLENDER_BIN);
  return result("Blender available", {
    executable: BLENDER_BIN,
    executable_size: stat.size,
    background_default: true,
  });
}

function blenderInspectGlb(root, args) {
  if (!fs.existsSync(BLENDER_BIN)) return unavailable("Blender executable not found", { executable: BLENDER_BIN });
  if (!args.glb_path) throw new Error("glb_path is required");
  const glb = safeInside(root, args.glb_path);
  const pyPath = JSON.stringify(glb.replaceAll("\\", "/"));
  const py = `import bpy,json; bpy.ops.import_scene.gltf(filepath=${pyPath}); ms=[o for o in bpy.data.objects if o.type=="MESH"]; print("HANAKO_JSON="+json.dumps({"mesh_objects":len(ms),"vertices":sum(len(o.data.vertices) for o in ms),"edges":sum(len(o.data.edges) for o in ms),"faces":sum(len(o.data.polygons) for o in ms),"armatures":len([o for o in bpy.data.objects if o.type=="ARMATURE"])}))`;
  const out = run(BLENDER_BIN, ["--background", "--factory-startup", "--python-expr", py], 30000);
  if (!out.ok) return out;
  return result("GLB inspected in Blender", { metrics: markerJson(out.stdout), validation: "PASS" });
}

function blenderInspect(root, args, statsOnly = false) {
  if (!fs.existsSync(BLENDER_BIN)) return unavailable("Blender executable not found", { executable: BLENDER_BIN });
  if (!args.blend_path) throw new Error("blend_path is required");
  const blend = safeInside(root, args.blend_path);
  let fingerprint = null;
  if (statsOnly) {
    fingerprint = fingerprintStep({
      capability: "blender.mesh_stats", adapter_version: "v1",
      backend: BLENDER_BIN, backend_mtime_ms: fs.statSync(BLENDER_BIN).mtimeMs,
      input_hashes: [fileSha256(blend)], args: {},
    });
    const hit = cacheGet(root, fingerprint);
    if (hit?.result?.metrics) return result("Blender mesh statistics reused", { metrics: hit.result.metrics, cache_hit: true, fingerprint });
  }
  const py = statsOnly
    ? 'import bpy,json; ms=[o for o in bpy.data.objects if o.type=="MESH"]; print("HANAKO_JSON="+json.dumps({"mesh_objects":len(ms),"vertices":sum(len(o.data.vertices) for o in ms),"edges":sum(len(o.data.edges) for o in ms),"faces":sum(len(o.data.polygons) for o in ms)}))'
    : 'import bpy,json; print("HANAKO_JSON="+json.dumps({"file":bpy.data.filepath,"objects":len(bpy.data.objects),"meshes":len(bpy.data.meshes),"armatures":len(bpy.data.armatures),"materials":len(bpy.data.materials),"version":bpy.app.version_string}))';
  const out = run(BLENDER_BIN, ["--background", blend, "--python-expr", py], 30000);
  if (!out.ok) return out;
  const payload = markerJson(out.stdout);
  if (statsOnly && fingerprint) cachePut(root, fingerprint, {
    capability: "blender.mesh_stats", result: { metrics: payload }, validation: "PASS",
  });
  return result(statsOnly ? "Blender mesh statistics collected" : "Blender file inspected", { metrics: payload, ...(fingerprint ? { cache_hit: false, fingerprint } : {}) });
}

function comfyAdapter(root, operation, payload = {}, timeoutMs = 30000) {
  const raw = runAdapterSync(root, "comfyui", operation, payload, timeoutMs);
  return {
    ok: raw.state === "succeeded",
    state: raw.state,
    summary: raw.summary,
    metrics: raw.metrics || {},
    validation: raw.validation || null,
    error_class: raw.error_class || null,
    detail_ref: raw.detail_ref || null,
  };
}

function comfyStatic(root, operation, args = {}) {
  return comfyAdapter(root, operation, args, operation === "models_list" ? 20000 : 10000);
}

function comfySubmit(root, args) {
  if (!args.workflow || typeof args.workflow !== "object") throw new Error("workflow is required for queue_submit");
  const job = createJob(root, {
    task_id: args.task_id || null,
    capability: "comfyui.queue.submit",
    backend: "comfyui",
    resource_class: "GPU_HEAVY",
    state: "QUEUED",
    summary: "waiting for ComfyUI submission",
  });
  const lease = acquireHeavyGpu(root, job.job_id, { backend: "comfyui" });
  if (!lease.ok) {
    updateJob(root, job.job_id, {
      state: "FAILED", error_class: "resource_exhausted", finished_at: new Date().toISOString(),
      summary: `GPU_HEAVY is held by ${lease.holder.job_id}`,
    });
    return { ok: false, state: "failed", error_class: "resource_exhausted", summary: "Another GPU-heavy job is active", job_id: job.job_id, holder: lease.holder };
  }
  try {
    const submitted = comfyAdapter(root, "queue_submit", { workflow: args.workflow, client_id: args.client_id }, 20000);
    if (!submitted.ok) {
      releaseHeavyGpu(root, job.job_id);
      updateJob(root, job.job_id, {
        state: "FAILED", error_class: submitted.error_class || "backend_bug", finished_at: new Date().toISOString(), summary: submitted.summary,
      });
      return { ...submitted, job_id: job.job_id };
    }
    const remoteJobId = submitted.metrics?.job_id || submitted.metrics?.prompt_id;
    const running = updateJob(root, job.job_id, {
      state: "RUNNING", started_at: new Date().toISOString(), summary: "ComfyUI job submitted",
      metadata: { remote_job_id: remoteJobId, client_id: args.client_id || null },
    });
    return { ok: true, state: "running", summary: "ComfyUI job submitted", job_id: running.job_id, remote_job_id: remoteJobId, resource_class: "GPU_HEAVY" };
  } catch (error) {
    releaseHeavyGpu(root, job.job_id);
    updateJob(root, job.job_id, {
      state: "FAILED", error_class: "backend_bug", finished_at: new Date().toISOString(), summary: String(error?.message || error),
    });
    throw error;
  }
}

function comfyReleaseResourcesIfIdle(root) {
  const queue = comfyAdapter(root, "queue_status", {}, 10000);
  if (!queue.ok) return { attempted: false, released: false, reason: "queue_status_failed", queue };
  const running = Number(queue.metrics?.running || 0);
  const pending = Number(queue.metrics?.pending || 0);
  if (running || pending) return { attempted: false, released: false, reason: "queue_not_idle", running, pending };
  const released = comfyAdapter(root, "release_resources", {}, 10000);
  return { attempted: true, released: !!released.ok, result: released };
}

function comfyJobStatus(root, args) {
  if (!args.job_id) throw new Error("job_id is required for job_status");
  let job = getJob(root, args.job_id);
  if (!job) throw new Error("Job not found");
  if (job.backend !== "comfyui") throw new Error("Job does not belong to ComfyUI");
  if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.state)) {
    releaseHeavyGpu(root, job.job_id);
    const cleanup = comfyReleaseResourcesIfIdle(root);
    return { ok: job.state === "SUCCEEDED", state: job.state.toLowerCase(), summary: job.summary, job, cleanup };
  }
  const remoteJobId = job.metadata?.remote_job_id;
  if (!remoteJobId) throw new Error("ComfyUI job is missing remote_job_id");
  const status = comfyAdapter(root, "job_status", { job_id: remoteJobId }, 15000);
  const remoteState = status.metrics?.status;
  const map = { pending: "QUEUED", in_progress: "RUNNING", completed: "SUCCEEDED", failed: "FAILED", cancelled: "CANCELLED" };
  const nextState = map[remoteState] || job.state;
  const terminal = ["SUCCEEDED", "FAILED", "CANCELLED"].includes(nextState);
  job = updateJob(root, job.job_id, {
    state: nextState,
    error_class: nextState === "FAILED" ? (status.error_class || "backend_bug") : nextState === "CANCELLED" ? "cancelled" : null,
    finished_at: terminal ? (job.finished_at || new Date().toISOString()) : null,
    summary: status.summary || `ComfyUI job ${remoteState || "unknown"}`,
    metadata: { ...job.metadata, remote_status: remoteState || null, outputs_count: status.metrics?.outputs_count || 0 },
  });
  let cleanup = null;
  if (terminal) {
    releaseHeavyGpu(root, job.job_id);
    cleanup = comfyReleaseResourcesIfIdle(root);
  }
  return { ok: nextState !== "FAILED", state: nextState.toLowerCase(), summary: job.summary, job, remote: status, cleanup };
}

function comfyCancel(root, args) {
  if (!args.job_id) throw new Error("job_id is required for cancel_job");
  let job = getJob(root, args.job_id);
  if (!job) throw new Error("Job not found");
  if (job.backend !== "comfyui") throw new Error("Job does not belong to ComfyUI");
  if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.state)) {
    releaseHeavyGpu(root, job.job_id);
    const cleanup = comfyReleaseResourcesIfIdle(root);
    return { ok: true, state: job.state.toLowerCase(), summary: "Job is already terminal", job, cleanup };
  }
  const remoteJobId = job.metadata?.remote_job_id;
  if (!remoteJobId) throw new Error("ComfyUI job is missing remote_job_id");
  const cancelled = comfyAdapter(root, "cancel_job", { job_id: remoteJobId }, 15000);
  job = updateJob(root, job.job_id, {
    state: "CANCELLED", error_class: "cancelled", finished_at: new Date().toISOString(), summary: "ComfyUI job cancelled",
  });
  releaseHeavyGpu(root, job.job_id);
  const cleanup = comfyReleaseResourcesIfIdle(root);
  return { ok: cancelled.ok, state: "cancelled", summary: job.summary, job, remote: cancelled, cleanup };
}

function comfyOutputResolve(root, args) {
  if (!args.job_id) throw new Error("job_id is required for output_resolve");
  const job = getJob(root, args.job_id);
  if (!job) throw new Error("Job not found");
  if (job.backend !== "comfyui") throw new Error("Job does not belong to ComfyUI");
  const remoteJobId = job.metadata?.remote_job_id;
  if (!remoteJobId) throw new Error("ComfyUI job is missing remote_job_id");
  const resolved = comfyAdapter(root, "output_resolve", { job_id: remoteJobId }, 15000);
  return { ...resolved, job_id: job.job_id, remote_job_id: remoteJobId };
}

function triposrStatus(root = null) {
  const runner = path.join(TRIPOSR_ROOT, "run.py");
  const installed = fs.existsSync(TRIPOSR_ROOT) && fs.existsSync(TRIPOSR_PY) && fs.existsSync(runner);
  if (!installed) return unavailable("TripoSR backend is not fully installed", { root: TRIPOSR_ROOT, python: TRIPOSR_PY });
  const help = run(TRIPOSR_PY, [runner, "--help"], 15000);
  if (!help.ok) return { ...help, root: TRIPOSR_ROOT, python: TRIPOSR_PY };
  return result("TripoSR backend available", {
    backend: "triposr", root: TRIPOSR_ROOT, python: TRIPOSR_PY,
    local_model: fs.existsSync(TRIPOSR_MODEL) ? TRIPOSR_MODEL : null,
    supports_glb: /--model-save-format/.test(help.stdout),
    heavy_gpu: root ? currentHeavyGpu(root) : null,
  });
}

function collectFiles(dir, suffix, limit = 50) {
  const found = [];
  if (!dir || !fs.existsSync(dir)) return found;
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (found.length >= limit) return;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.toLowerCase().endsWith(suffix)) found.push(full);
    }
  };
  walk(dir);
  return found;
}

async function triposrGenerate(root, args) {
  const status = triposrStatus(root);
  if (!status.ok) return status;
  if (!args.source_image) throw new Error("source_image is required for generate_from_image");
  if (!args.output_dir) throw new Error("output_dir is required for generate_from_image");
  const source = safeInside(root, args.source_image);
  const outputDir = safeInside(root, args.output_dir, false);
  fs.mkdirSync(outputDir, { recursive: true });
  const job = createJob(root, {
    task_id: args.task_id || null,
    recipe_id: args.recipe_id || null,
    step_id: args.step_id || null,
    capability: "3d.generate.from_image",
    backend: "triposr",
    resource_class: "GPU_HEAVY",
    state: "QUEUED",
    summary: "waiting for TripoSR start",
    metadata: { source_image: source, output_dir: outputDir },
  });
  const lease = acquireHeavyGpu(root, job.job_id, { backend: "triposr" });
  if (!lease.ok) {
    updateJob(root, job.job_id, {
      state: "FAILED", error_class: "resource_exhausted", finished_at: new Date().toISOString(),
      summary: `GPU_HEAVY is held by ${lease.holder.job_id}`,
    });
    return { ok: false, state: "failed", error_class: "resource_exhausted", summary: "Another GPU-heavy job is active", job_id: job.job_id, holder: lease.holder };
  }

  const runner = path.join(TRIPOSR_ROOT, "run.py");
  const cmd = [
    "&", psQuote(TRIPOSR_PY), psQuote(runner), psQuote(source),
    "--device", psQuote(args.device || "cuda:0"),
    "--mc-resolution", String(args.mc_resolution || 256),
    "--output-dir", psQuote(outputDir),
    "--model-save-format", "glb",
    ...(fs.existsSync(TRIPOSR_MODEL) ? ["--pretrained-model-name-or-path", psQuote(TRIPOSR_MODEL)] : []),
    ...(args.remove_bg === false ? ["--no-remove-bg"] : []),
  ].join(" ");

  try {
    const started = await computerCall(root, "hanako_start_process", {
      command: cmd, cwd: root, timeout_ms: 1000, task_id: args.task_id || undefined,
    });
    const running = updateJob(root, job.job_id, {
      state: "RUNNING", process_id: started.process_id, started_at: new Date().toISOString(),
      summary: "TripoSR generation running",
    });
    return {
      ok: true, state: "running", summary: "TripoSR generation submitted",
      job_id: running.job_id, process_id: running.process_id, resource_class: "GPU_HEAVY",
      output_dir: outputDir,
    };
  } catch (error) {
    releaseHeavyGpu(root, job.job_id);
    updateJob(root, job.job_id, { state: "FAILED", error_class: "backend_bug", finished_at: new Date().toISOString(), summary: String(error?.message || error) });
    throw error;
  }
}

async function triposrJobStatus(root, args) {
  if (!args.job_id) throw new Error("job_id is required for job_status");
  let job = getJob(root, args.job_id);
  if (!job) throw new Error("Job not found");
  if (job.backend !== "triposr") throw new Error("Job does not belong to TripoSR");
  if (job.state === "RUNNING" && job.process_id) {
    let processObservable = true;
    try {
      await computerCall(root, "hanako_process_output", { process_id: job.process_id, timeout_ms: 100, offset: 0, length: 200 });
    } catch {
      processObservable = false;
    }
    job = getJob(root, args.job_id) || job;
    if (!processObservable && job.state === "RUNNING" && job.metadata?.output_dir) {
      const recovered = collectFiles(job.metadata.output_dir, ".glb", 20).filter(file => {
        try {
          const stat = fs.statSync(file);
          return stat.isFile() && stat.size > 1024 && (Date.now() - stat.mtimeMs) >= 500;
        } catch {
          return false;
        }
      });
      if (recovered.length) {
        job = updateJob(root, job.job_id, {
          state: "SUCCEEDED",
          finished_at: new Date().toISOString(),
          summary: "TripoSR generation reconciled from durable output after process session loss",
          metadata: { ...job.metadata, reconciled_after_session_loss: true },
        });
      }
    }
  }
  if (job.state === "SUCCEEDED" && job.metadata?.output_dir) {
    const glbs = collectFiles(job.metadata.output_dir, ".glb", 20);
    const currentIds = (job.artifacts || []).filter(value => /^artifact-/.test(String(value)));
    if (glbs.length && currentIds.length !== glbs.length) {
      const receipts = glbs.map(file => recordArtifact(root, {
        kind: "glb", path: file, producer_capability: "3d.generate.from_image",
        producer_job_id: job.job_id, task_id: job.task_id, validation: "PASS",
      }));
      job = updateJob(root, job.job_id, {
        artifacts: receipts.map(item => item.artifact_id),
        metadata: { ...job.metadata, artifact_paths: receipts.map(item => item.path) },
        summary: "TripoSR generation completed",
      });
    }
  }
  const artifact_records = (job.artifacts || [])
    .filter(id => /^artifact-/.test(String(id)))
    .map(id => getArtifact(root, id)).filter(Boolean);
  if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.state)) {
    releaseHeavyGpu(root, job.job_id);
  }
  return { ok: job.state !== "FAILED", state: job.state.toLowerCase(), summary: job.summary || "TripoSR job status", job, artifact_records };
}

async function triposrCancel(root, args) {
  if (!args.job_id) throw new Error("job_id is required for cancel_job");
  const job = getJob(root, args.job_id);
  if (!job) throw new Error("Job not found");
  if (job.backend !== "triposr") throw new Error("Job does not belong to TripoSR");
  if (!job.process_id || ["SUCCEEDED", "FAILED", "CANCELLED"].includes(job.state)) {
    releaseHeavyGpu(root, job.job_id);
    return { ok: true, state: job.state.toLowerCase(), summary: "Job is not running", job };
  }
  await computerCall(root, "hanako_kill_process", { process_id: job.process_id });
  releaseHeavyGpu(root, job.job_id);
  return { ok: true, state: "cancelled", summary: "TripoSR job cancelled", job: getJob(root, job.job_id) };
}

function recipeFailure(root, recipeId, stepId, errorClass, detail) {
  const message = String(detail || errorClass || "recipe step failed").slice(0, 2000);
  updateStep(root, recipeId, stepId, { state: "FAILED", error: { error_class: errorClass || "backend_bug", detail: message } });
  return updateRecipe(root, recipeId, { state: "FAILED", finished_at: new Date().toISOString() });
}

async function startMouseAssetRecipe(root, args) {
  if (!args.source_image) throw new Error("source_image is required for mouse_asset_validation_v1");
  const source = safeInside(root, args.source_image);
  const recipe = createRecipe(root, {
    recipe: "mouse_asset_validation_v1",
    task_id: args.task_id || null,
    inputs: { source_image: source, device: args.device || "cuda:0", mc_resolution: args.mc_resolution || 128 },
    steps: [
      { step_id: "generate_3d", capability: "3d.generate.from_image" },
      { step_id: "blender_glb_validate", capability: "blender.inspect_glb" },
      { step_id: "godot_import_validate", capability: "godot.import_check" },
    ],
  });
  const runDir = safeInside(root, path.join(root, "work", "bridge", "recipe-runs", recipe.recipe_id), false);
  const outputDir = path.join(runDir, "triposr");
  fs.mkdirSync(outputDir, { recursive: true });
  updateRecipe(root, recipe.recipe_id, { inputs: { ...recipe.inputs, run_dir: runDir, output_dir: outputDir } });
  try {
    const submitted = await triposrGenerate(root, {
      source_image: source, output_dir: outputDir, device: args.device || "cuda:0",
      mc_resolution: args.mc_resolution || 128, task_id: args.task_id || null,
      recipe_id: recipe.recipe_id, step_id: "generate_3d", backend: "triposr",
    });
    if (!submitted.ok) {
      const failed = recipeFailure(root, recipe.recipe_id, "generate_3d", submitted.error_class || "backend_bug", submitted.summary);
      return { ok: false, state: "failed", summary: submitted.summary, recipe: failed };
    }
    updateStep(root, recipe.recipe_id, "generate_3d", {
      state: "RUNNING", attempt: 1, job_id: submitted.job_id,
      evidence: { process_id: submitted.process_id, output_dir: submitted.output_dir },
    });
    return { ok: true, state: "running", summary: "Mouse asset validation recipe started", recipe: getRecipe(root, recipe.recipe_id) };
  } catch (error) {
    const failed = recipeFailure(root, recipe.recipe_id, "generate_3d", "backend_bug", error?.message || error);
    return { ok: false, state: "failed", summary: String(error?.message || error), recipe: failed };
  }
}

async function resumeMouseAssetRecipe(root, recipeId) {
  let recipe = getRecipe(root, recipeId);
  if (!recipe) throw new Error("Recipe not found");
  if (recipe.recipe !== "mouse_asset_validation_v1") throw new Error("Unsupported recipe type");
  if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(recipe.state)) {
    return { ok: recipe.state === "SUCCEEDED", state: recipe.state.toLowerCase(), summary: "Recipe is terminal", recipe };
  }

  let generate = recipe.steps.find(step => step.step_id === "generate_3d");
  if (generate.state === "PENDING") {
    const submitted = await triposrGenerate(root, {
      source_image: recipe.inputs.source_image, output_dir: recipe.inputs.output_dir,
      device: recipe.inputs.device, mc_resolution: recipe.inputs.mc_resolution,
      task_id: recipe.task_id, recipe_id: recipe.recipe_id, step_id: "generate_3d", backend: "triposr",
    });
    if (!submitted.ok) {
      recipe = recipeFailure(root, recipeId, "generate_3d", submitted.error_class || "backend_bug", submitted.summary);
      return { ok: false, state: "failed", summary: submitted.summary, recipe };
    }
    updateStep(root, recipeId, "generate_3d", { state: "RUNNING", attempt: generate.attempt + 1, job_id: submitted.job_id, evidence: { process_id: submitted.process_id } });
    return { ok: true, state: "running", summary: "3D generation submitted", recipe: getRecipe(root, recipeId) };
  }
  if (generate.state === "RUNNING") {
    const status = await triposrJobStatus(root, { job_id: generate.job_id, backend: "triposr" });
    if (status.state === "running" || status.state === "queued") {
      return { ok: true, state: "running", summary: "3D generation still running", recipe: getRecipe(root, recipeId), job: status.job };
    }
    if (status.state !== "succeeded") {
      recipe = recipeFailure(root, recipeId, "generate_3d", status.job?.error_class || "backend_bug", status.summary);
      return { ok: false, state: "failed", summary: status.summary, recipe };
    }
    const artifactIds = (status.artifact_records || []).map(item => item.artifact_id);
    if (!artifactIds.length) {
      recipe = recipeFailure(root, recipeId, "generate_3d", "validation_failed", "TripoSR completed without a GLB artifact receipt");
      return { ok: false, state: "failed", summary: "No GLB artifact", recipe };
    }
    updateStep(root, recipeId, "generate_3d", {
      state: "SUCCEEDED", output_artifacts: artifactIds,
      evidence: { job_id: status.job.job_id, artifact_ids: artifactIds }, error: null,
    });
    recipe = getRecipe(root, recipeId);
    generate = recipe.steps.find(step => step.step_id === "generate_3d");
  }

  let blender = recipe.steps.find(step => step.step_id === "blender_glb_validate");
  if (blender.state === "PENDING") {
    const artifactId = generate.output_artifacts[0];
    const artifact = getArtifact(root, artifactId);
    if (!artifact) {
      recipe = recipeFailure(root, recipeId, "blender_glb_validate", "validation_failed", "Input GLB artifact receipt is missing");
      return { ok: false, state: "failed", summary: "Input artifact missing", recipe };
    }
    updateStep(root, recipeId, "blender_glb_validate", { state: "RUNNING", attempt: blender.attempt + 1, input_artifacts: [artifactId] });
    const inspected = blenderInspectGlb(root, { glb_path: artifact.path });
    if (!inspected.ok) {
      recipe = recipeFailure(root, recipeId, "blender_glb_validate", inspected.error_class || "validation_failed", inspected.summary);
      return { ok: false, state: "failed", summary: inspected.summary, recipe };
    }
    updateStep(root, recipeId, "blender_glb_validate", {
      state: "SUCCEEDED", output_artifacts: [artifactId], evidence: { validation: inspected.validation || "PASS", metrics: inspected.metrics }, error: null,
    });
    recipe = getRecipe(root, recipeId);
    blender = recipe.steps.find(step => step.step_id === "blender_glb_validate");
  }

  let godot = recipe.steps.find(step => step.step_id === "godot_import_validate");
  if (godot.state === "PENDING") {
    const artifactId = blender.output_artifacts[0];
    const artifact = getArtifact(root, artifactId);
    if (!artifact) {
      recipe = recipeFailure(root, recipeId, "godot_import_validate", "validation_failed", "Validated GLB artifact receipt is missing");
      return { ok: false, state: "failed", summary: "Validated artifact missing", recipe };
    }
    updateStep(root, recipeId, "godot_import_validate", { state: "RUNNING", attempt: godot.attempt + 1, input_artifacts: [artifactId] });
    const sandbox = path.join(recipe.inputs.run_dir, "godot-import");
    fs.mkdirSync(sandbox, { recursive: true });
    const assetPath = path.join(sandbox, "asset.glb");
    fs.copyFileSync(artifact.path, assetPath);
    fs.writeFileSync(path.join(sandbox, "project.godot"), [
      "; Hanako isolated asset import validation",
      "config_version=5",
      "",
      "[application]",
      'config/name="Hanako Asset Import Validation"',
      "",
      "[rendering]",
      'renderer/rendering_method="gl_compatibility"',
      'renderer/rendering_method.mobile="gl_compatibility"',
      "",
    ].join("\n"));
    const checked = await computerCall(root, "hanako_godot", { cwd: sandbox, operation: "import_check", timeout_ms: 30000 });
    const importedDir = path.join(sandbox, ".godot", "imported");
    let importedFiles = fs.existsSync(importedDir) ? collectFiles(importedDir, "", 200) : [];
    for (let i = 0; checked.ok && checked.exit_code === 0 && importedFiles.length === 0 && i < 20; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 250));
      importedFiles = fs.existsSync(importedDir) ? collectFiles(importedDir, "", 200) : [];
    }
    if (!checked.ok || checked.exit_code !== 0 || importedFiles.length === 0) {
      recipe = recipeFailure(root, recipeId, "godot_import_validate", "validation_failed", `Godot import validation failed; exit=${checked.exit_code ?? "unknown"} imported=${importedFiles.length}`);
      return { ok: false, state: "failed", summary: "Godot import validation failed", recipe };
    }
    updateStep(root, recipeId, "godot_import_validate", {
      state: "SUCCEEDED", output_artifacts: [artifactId],
      evidence: { validation: "PASS", sandbox, imported_files: importedFiles.length }, error: null,
    });
    recipe = updateRecipe(root, recipeId, { state: "SUCCEEDED", finished_at: new Date().toISOString() });
    return { ok: true, state: "succeeded", summary: "Mouse asset validation recipe completed", recipe };
  }

  recipe = getRecipe(root, recipeId);
  if (recipe.steps.every(step => step.state === "SUCCEEDED")) recipe = updateRecipe(root, recipeId, { state: "SUCCEEDED", finished_at: recipe.finished_at || new Date().toISOString() });
  return { ok: recipe.state === "SUCCEEDED", state: recipe.state.toLowerCase(), summary: "Recipe checkpoint loaded", recipe };
}

async function callRecipe(root, args) {
  if (args.operation === "start") {
    if ((args.recipe || "mouse_asset_validation_v1") !== "mouse_asset_validation_v1") throw new Error("Unsupported recipe");
    return startMouseAssetRecipe(root, { ...args, recipe: "mouse_asset_validation_v1" });
  }
  if (!args.recipe_id) throw new Error("recipe_id is required for status/resume");
  if (args.operation === "status") {
    const recipe = getRecipe(root, args.recipe_id);
    if (!recipe) throw new Error("Recipe not found");
    return { ok: recipe.state !== "FAILED", state: recipe.state.toLowerCase(), summary: "Recipe status", recipe };
  }
  if (args.operation === "resume") return resumeMouseAssetRecipe(root, args.recipe_id);
  throw new Error("Unsupported recipe operation");
}

export async function vnextCall(root, name, args = {}) {
  if (name === "hanako_ops") return callOps(root, args);
  if (name === "hanako_observe") return callObserve(root, args);
  if (name === "hanako_gui") return callGui(root, args);
  if (name === "hanako_browser") return callBrowser(root, args);
  if (name === "hanako_blender") {
    if (args.operation === "status") return blenderStatus();
    if (args.operation === "inspect_blend") return blenderInspect(root, args, false);
    if (args.operation === "mesh_stats") return blenderInspect(root, args, true);
    if (args.operation === "inspect_glb") return blenderInspectGlb(root, args);
  }
  if (name === "hanako_comfyui") {
    if (["status", "models_list", "queue_status", "workflow_validate"].includes(args.operation)) return comfyStatic(root, args.operation, args);
    if (args.operation === "queue_submit") return comfySubmit(root, args);
    if (args.operation === "job_status") return comfyJobStatus(root, args);
    if (args.operation === "cancel_job") return comfyCancel(root, args);
    if (args.operation === "output_resolve") return comfyOutputResolve(root, args);
  }
  if (name === "hanako_3d") {
    if ((args.backend || "triposr") !== "triposr") throw new Error("Unsupported 3D backend");
    if (args.operation === "status") return triposrStatus(root);
    if (args.operation === "generate_from_image") return triposrGenerate(root, args);
    if (args.operation === "job_status") return triposrJobStatus(root, args);
    if (args.operation === "cancel_job") return triposrCancel(root, args);
  }
  if (name === "hanako_recipe") return callRecipe(root, args);
  throw new Error(`Unsupported vNext tool or operation: ${name}/${args.operation || "-"}`);
}
