/** Minimal direct construction surface over the proven computer adapter. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { computerCall, commandAllowed } from "./computer-adapter.mjs";
import { nativeRead, nativeWrite, nativePatch } from "./native-file-ops.mjs";
import { nativeGit } from "./hybrid-git.mjs";
import { nativeSearch } from "./hybrid-search.mjs";
import { isPreviewMediaPath, observePreview, observeCapturedPreview } from "./media-preview.mjs";
import { isDeniedPath } from "./bridge-core.mjs";
import { runAdapterAsync } from "./python-adapter-bridge.mjs";
import { browserClick, browserDumpDom, browserFill, browserInspect, browserScreenshot, browserType } from "./browser-cdp.mjs";
import { constructionCall, createConstructionContext } from "./mouse-hole-construction-state.mjs";
import { MICE_HOLE_VERSION } from "./mouse-hole-project-memory.mjs";

const MAX_OUTPUT = 12_000;
const MAX_FILES = 5_000;
const MAX_SCAN_ITEMS = 20_000;
const SKIP_DIRS = new Set([".git", ".godot", "node_modules", "__pycache__", ".venv"]);
const EDGE_BIN = process.env.EDGE_BIN || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
// Edge-only: foreground fallback relies on the user\'s existing Edge login/cookie profile.
// Do not silently select Chrome or a different browser when Edge is unavailable.
const BROWSER_BIN = fs.existsSync(EDGE_BIN) ? EDGE_BIN : null;
const BROWSER_PROCESS_NAME = BROWSER_BIN ? path.basename(BROWSER_BIN, path.extname(BROWSER_BIN)) : null;
const GUI_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "gui-windows.ps1");
const GUI_PLACEMENT_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "gui-placement.ps1");
const GUI_NATIVE_BUTTON_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "gui-native-button.py");
const COMFYUI_URL = (process.env.COMFYUI_URL || "http://127.0.0.1:8188").replace(/\/+$/, "");

const schema = (properties, required = []) => ({
  type: "object", properties, required, additionalProperties: false,
});

const core = [
  ["mouse_hole_status", "Check runtime readiness or read typed system diagnostics", { detail: { type: "string", enum: ["runtime", "processes", "service", "port", "startup", "power", "gpu"] }, name: { type: "string", maxLength: 256 }, port: { type: "integer", minimum: 1, maximum: 65535 }, limit: { type: "integer", minimum: 1, maximum: 200 } }, [], true],
  ["mouse_hole_read", "Read a workspace file. For continue/继续施工, first read construction://continue?project=<workspace-relative project> to recover PROJECT.md, STATUS.md and TODO.md. Omit project only when the current project is unambiguous.", { path: { type: "string" }, offset: { type: "integer" }, length: { type: "integer" } }, ["path"], true],
  ["mouse_hole_write", "Write a workspace file. Project continuity uses construction://start|checkpoint|continue|resume|finish with JSON content and an optional project or cwd. continue/resume can reactivate DONE; project files retain memory across connections. Continue the authorized next step after recovery.", { path: { type: "string" }, content: { type: "string" } }, ["path", "content"], false],
  ["mouse_hole_patch", "Replace an exact text block in a workspace file", { path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" }, expected_replacements: { type: "integer", minimum: 1 } }, ["path", "old_string", "new_string"], false],
  ["mouse_hole_search", "Search workspace files; falls back to local traversal if ripgrep is unavailable", { path: { type: "string" }, pattern: { type: "string" }, search_type: { type: "string", enum: ["files", "content"] }, limit: { type: "integer", minimum: 1, maximum: 100 } }, ["pattern"], true],
  ["mouse_hole_run", "Run a bounded command in the workspace", { command: { type: "string" }, cwd: { type: "string" }, timeout_ms: { type: "integer" } }, ["command"], false],
  ["mouse_hole_process", "Start, inspect, read output from, or stop a persistent process", { operation: { type: "string", enum: ["start", "status", "output", "wait", "stop"] }, process_id: { type: "integer" }, command: { type: "string" }, cwd: { type: "string" }, timeout_ms: { type: "integer" }, wait_ms: { type: "integer", minimum: 0, maximum: 30000 }, offset: { type: "integer" }, length: { type: "integer" } }, ["operation"], false],
  ["mouse_hole_git", "Read repository status or diff", { operation: { type: "string", enum: ["status", "diff"] }, cwd: { type: "string" }, path: { type: "string" } }, ["operation"], true],
  ["mouse_hole_validate", "Run a bounded repository validation command", { cwd: { type: "string" }, command: { type: "string" }, timeout_ms: { type: "integer" } }, ["command"], false],
].map(([name, description, properties, required, readOnlyHint]) => ({
  name, description,
  inputSchema: schema(properties, required),
  annotations: { readOnlyHint, destructiveHint: !readOnlyHint, openWorldHint: false },
}));

const applicationTools = [
  { name: "mouse_hole_blender", description: "Operate Blender headlessly with bpy", inputSchema: schema({ operation: { type: "string", enum: ["status", "inspect_blend", "mesh_stats", "inspect_glb", "normalize_mesh", "validate", "render_validation", "export_glb", "artifact_report", "batch"] }, blend: { type: "string" }, path: { type: "string" }, glb: { type: "string" }, output: { type: "string" }, target_size: { type: "number", minimum: 0.001, maximum: 10000 }, steps: { type: "array", maxItems: 8, items: { type: "object", properties: { operation: { type: "string", enum: ["normalize_mesh", "validate", "render_validation", "export_glb", "artifact_report"] }, output: { type: "string" }, target_size: { type: "number", minimum: 0.001, maximum: 10000 } }, required: ["operation"], additionalProperties: false } } }, ["operation"]), annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false } },
  { name: "mouse_hole_godot", description: "Validate, import, run and inspect a Godot project headlessly", inputSchema: schema({ operation: { type: "string", enum: ["project_status", "validate_project", "import_check", "test_scene", "run_scene", "read_errors", "capture_result"] }, project: { type: "string" }, cwd: { type: "string" }, scene: { type: "string" }, log_path: { type: "string" }, output: { type: "string" }, timeout_seconds: { type: "integer", minimum: 1, maximum: 600 } }, ["operation"]), annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false } },
  { name: "mouse_hole_comfyui", description: "Use ComfyUI status, workflow validation, generation and remote job handles", inputSchema: schema({ operation: { type: "string", enum: ["status", "workflow_validate", "generate", "job_status", "cancel", "output_resolve"] }, workflow: { type: "object", additionalProperties: true }, client_id: { type: "string" }, job_id: { type: "string" }, wait_ms: { type: "integer", minimum: 0, maximum: 30000 }, poll_interval_ms: { type: "integer", minimum: 100, maximum: 5000 } }, ["operation"]), annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true } },
  { name: "mouse_hole_browser", description: "Control structured Chromium browsing with explicit foreground fallback for anti-bot/login pages", inputSchema: schema({ operation: { type: "string", enum: ["status", "dump_dom", "inspect", "click", "fill", "type", "screenshot", "open_foreground", "read_foreground_text"] }, url: { type: "string" }, selector: { type: "string" }, text: { type: "string" }, title: { type: "string", maxLength: 512 }, foreground_control: { type: "boolean" }, wait_ms: { type: "integer", minimum: 0, maximum: 30000 }, output_path: { type: "string" }, width: { type: "integer", minimum: 320, maximum: 3840 }, height: { type: "integer", minimum: 240, maximum: 2160 }, max_chars: { type: "integer", minimum: 1000, maximum: 120000 } }, ["operation"]), annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true } },
  { name: "mouse_hole_observe", description: "Read a screenshot or image result without GUI actuation", inputSchema: schema({ target: { type: "string", enum: ["screen", "window", "image", "resource"] }, title: { type: "string" }, path: { type: "string" } }, ["target"]), annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  { name: "mouse_hole_gui", description: "Launch new Agent-owned Windows GUI in a free screen quadrant, or use guarded foreground input; foreground_control=true required for actuation", inputSchema: schema({ operation: { type: "string", enum: ["status", "wait", "launch", "focus_window", "move", "click", "double_click", "right_click", "drag", "scroll", "type_text", "key_press", "hotkey"] }, foreground_control: { type: "boolean" }, x: { type: "integer" }, y: { type: "integer" }, x2: { type: "integer" }, y2: { type: "integer" }, delta: { type: "integer", minimum: -12000, maximum: 12000 }, text: { type: "string", maxLength: 4000 }, title: { type: "string", maxLength: 512 }, key: { type: "string", enum: ["ENTER", "TAB", "ESC", "SPACE", "BACKSPACE", "DELETE", "UP", "DOWN", "LEFT", "RIGHT", "HOME", "END", "PAGEUP", "PAGEDOWN", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12", "A", "C", "V", "X", "Y", "Z"] }, modifiers: { type: "array", maxItems: 3, uniqueItems: true, items: { type: "string", enum: ["CTRL", "ALT", "SHIFT"] } }, duration_ms: { type: "integer", minimum: 0, maximum: 30000 }, executable: { type: "string", maxLength: 2048 }, arguments: { type: "string", maxLength: 4000 } }, ["operation"]), annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false } },
];

export const MOUSE_HOLE_TOOLS = [...core, ...applicationTools].filter(tool => !["mouse_hole_blender", "mouse_hole_godot", "mouse_hole_comfyui"].includes(tool.name));
export const MOUSE_HOLE_CORE_TOOLS = MOUSE_HOLE_TOOLS;
export const MOUSE_HOLE_SCHEMA_FINGERPRINT = createHash("sha256")
  .update(JSON.stringify(MOUSE_HOLE_TOOLS))
  .digest("hex")
  .slice(0, 16);

function compactAdapter(raw, operation) {
  const metrics = raw?.metrics || {};
  const keys = ["returncode", "duration_seconds", "meshes", "vertices", "edges", "faces", "non_finite_vertices", "validation", "output", "bytes", "target_size", "scale", "dimensions", "objects", "mesh_objects", "armatures", "binary", "version", "project", "log_path", "error_count", "job_id", "prompt_id", "status", "running", "pending", "count", "url", "outputs_count", "preview_output", "error_node", "error_message"];
  const metadata = Object.fromEntries(keys.filter(key => metrics[key] !== undefined).map(key => [key, metrics[key]]));
  if (Array.isArray(metrics.errors)) metadata.errors = metrics.errors.slice(0, 30).map(line => String(line).slice(0, 500));
  const refs = Array.isArray(raw?.artifact_refs) ? raw.artifact_refs.map(item => {
    const value = typeof item === "string" ? item : item?.path;
    if (!value) return null;
    const ext = path.extname(value).toLowerCase();
    const type = ({ ".blend": "model/blender", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".json": "application/json", ".tscn": "text/plain" })[ext] || "application/octet-stream";
    return { path: value, type, source: operation, validation: metadata.validation || "not_reported" };
  }).filter(Boolean) : [];
  return compact({ ok: raw?.state === "succeeded", path: refs[0]?.path, artifacts: refs, output: raw?.summary, metadata, error_class: raw?.error_class, error_detail: raw?.detail_ref }, operation);
}

function compact(raw, operation) {
  if (!raw || typeof raw !== "object") return { ok: true, operation, output: String(raw || "").slice(0, MAX_OUTPUT) };
  const result = { ok: raw.ok !== false, operation };
  for (const key of ["path", "artifacts", "process_id", "running", "exit_code", "command_summary", "maintenance_action", "metadata", "truncated", "complete", "backend"]) {
    if (raw[key] !== undefined) result[key] = raw[key];
  }
  if (raw.output !== undefined) result.output = String(raw.output).slice(0, MAX_OUTPUT);
  if (raw.error_class) result.error_class = raw.error_class;
  if (raw.error_detail) {
    result.failure = raw.error_class || "operation_failed";
    result.reason = String(raw.error_detail).slice(0, 400);
  }
  if (raw.__mcp_content) result.__mcp_content = raw.__mcp_content;
  if (raw.ok === false && raw.exit_code === undefined) result.retryable = true;
  return result;
}

function safeSearchRoot(root, value) {
  const base = fs.realpathSync.native(root);
  const requested = path.resolve(base, value || ".");
  const real = fs.realpathSync.native(requested);
  const relative = path.relative(base, real);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || isDeniedPath(relative)) {
    throw new Error("Search path must remain inside the workspace and outside credential-like paths");
  }
  return real;
}

function fallbackSearch(root, args) {
  const start = safeSearchRoot(root, args.path);
  const needle = String(args.pattern ?? "");
  if (!needle) throw new Error("pattern is required");
  const mode = args.search_type || "content";
  const limit = Math.max(1, Math.min(Number(args.limit) || 50, 100));
  const matches = [];
  const stack = [start];
  let visited = 0;
  let scanned = 0;
  while (stack.length && visited < MAX_FILES && scanned < MAX_SCAN_ITEMS && matches.length < limit) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (matches.length >= limit || visited >= MAX_FILES || scanned >= MAX_SCAN_ITEMS) break;
      scanned += 1;
      if (entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      const relative = path.relative(root, file).replaceAll("\\", "/");
      if (isDeniedPath(relative)) continue;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(file);
        continue;
      }
      if (!entry.isFile()) continue;
      visited += 1;
      if (mode === "files") {
        if (entry.name.toLowerCase().includes(needle.toLowerCase())) matches.push(relative);
        continue;
      }
      try {
        const stat = fs.statSync(file);
        if (stat.size > 1_000_000) continue;
        const text = fs.readFileSync(file, "utf8");
        if (text.includes("\u0000")) continue;
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length && matches.length < limit; i += 1) {
          if (lines[i].includes(needle)) matches.push(`${relative}:${i + 1}: ${lines[i].slice(0, 300)}`);
        }
      } catch {}
    }
  }
  return { ok: true, operation: "search", output: matches.join("\n").slice(0, MAX_OUTPUT), truncated: stack.length > 0 || visited >= MAX_FILES || scanned >= MAX_SCAN_ITEMS, backend: "local_fallback" };
}

function isRipgrepUnavailable(error) {
  const message = String(error?.message || error).toLowerCase();
  return /ripgrep|\brg(?:\.exe)?\b|start_search.*(?:not found|enoent|spawn)|cannot find.*(?:rg|ripgrep)|commandnotfoundexception/.test(message);
}

function browserArtifactPath(root, value) {
  const base = fs.realpathSync.native(root);
  const output = path.resolve(base, value);
  let ancestor = output;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const realAncestor = fs.realpathSync.native(ancestor);
  const rel = path.relative(base, output);
  const realRel = path.relative(base, realAncestor);
  if ([rel, realRel].some(item => item === ".." || item.startsWith(`..${path.sep}`) || path.isAbsolute(item)) || isDeniedPath(rel)) {
    throw new Error("Browser artifact path must remain inside the workspace and outside credential-like paths");
  }
  return output;
}

function browserUrl(value) {
  if (!value) throw new Error("url is required");
  const parsed = new URL(String(value));
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only http/https URLs are supported");
  return parsed.toString();
}

function browserBlockSignal(dom) {
  const text = String(dom || "");
  const zhihu40362 = /\"code\"\s*:\s*40362|当前请求存在异常|zse-ck/i.test(text);
  const generic = /captcha|verify you are human|access denied|unusual traffic|robot check|人机验证|安全验证/i.test(text);
  if (zhihu40362) return { blocked: true, reason: "zhihu_40362", foreground_fallback_recommended: true };
  if (generic) return { blocked: true, reason: "anti_bot_or_challenge", foreground_fallback_recommended: true };
  return { blocked: false, reason: null, foreground_fallback_recommended: false };
}

function foregroundPageText(args) {
  if (args.foreground_control !== true) throw new Error("foreground_control=true is required for foreground browser fallback");
  if (!BROWSER_PROCESS_NAME) throw new Error("No supported Chromium browser found");
  const titleFilter = args.title ? `$_.MainWindowTitle -like ${psString(`*${args.title}*`)}` : "$true";
  const maxChars = Math.max(1000, Math.min(120000, Number(args.max_chars || 30000)));
  const waitMs = Math.max(0, Math.min(30000, Number(args.wait_ms ?? 800)));
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$old=[System.Windows.Forms.Clipboard]::GetDataObject()",
    "$encoded=$null",
    "try {",
    `$matches=@(Get-Process -Name ${psString(BROWSER_PROCESS_NAME)} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and (${titleFilter}) })`,
    "if($matches.Count -eq 0){throw 'No supported foreground browser window found'}",
    "if($matches.Count -gt 1){throw 'Multiple foreground browser windows found; provide a more specific title'}",
    "$p=$matches[0]",
    "$shell=New-Object -ComObject WScript.Shell",
    "if(-not $shell.AppActivate($p.Id)){throw 'Failed to activate foreground browser'}",
    `Start-Sleep -Milliseconds ${waitMs}`,
    "[System.Windows.Forms.SendKeys]::SendWait('{ESC}')",
    "Start-Sleep -Milliseconds 100",
    "[System.Windows.Forms.SendKeys]::SendWait('^a')",
    "Start-Sleep -Milliseconds 100",
    "[System.Windows.Forms.SendKeys]::SendWait('^c')",
    "Start-Sleep -Milliseconds 250",
    "$t=[System.Windows.Forms.Clipboard]::GetText()",
    "$encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t))",
    "} finally {",
    "if($null -ne $old){[System.Windows.Forms.Clipboard]::SetDataObject($old,$true)}else{[System.Windows.Forms.Clipboard]::Clear()}",
    "}",
    "$encoded",
  ].join("; ");
  const child = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Sta", "-ExecutionPolicy", "Bypass", "-Command", script], { encoding: "utf8", windowsHide: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(String(child.stderr || child.stdout || "Foreground browser read failed").slice(-1500));
  const raw = String(child.stdout || "").trim().split(/\r?\n/).filter(Boolean).at(-1) || "";
  const text = Buffer.from(raw, "base64").toString("utf8");
  return { text: text.slice(0, maxChars), total_chars: text.length, truncated: text.length > maxChars };
}

// Optional, fail-open layout hook: only handles created after our launch are eligible.
// Existing Edge windows and windows opened by another process remain untouched.
function snapshotBrowserWindows() {
  try {
    const result = spawnSync("powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Sta", "-ExecutionPolicy", "Bypass",
       "-File", GUI_PLACEMENT_SCRIPT, "-Mode", "snapshot", "-ProcessName", BROWSER_PROCESS_NAME],
      { encoding: "utf8", windowsHide: true, timeout: 3500, maxBuffer: 128 * 1024 });
    if (result.status !== 0) return null;
    const payload = JSON.parse(String(result.stdout).trim().split(/\\r?\\n/).at(-1));
    return Array.isArray(payload.handles) ? payload.handles : null;
  } catch { return null; }
}

async function placeNewBrowserWindow(knownHandles, expectedPid) {
  if (!knownHandles) return { placed: false, reason: "snapshot_unavailable" };
  return await new Promise(resolve => {
    const child = spawn("powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Sta", "-ExecutionPolicy", "Bypass",
       "-File", GUI_PLACEMENT_SCRIPT, "-Mode", "place", "-ProcessName", BROWSER_PROCESS_NAME,
       "-KnownHandles", knownHandles.join(","), "-ExpectedPid", String(expectedPid || 0), "-WaitMs", "2200"],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ placed: false, reason: "placement_timeout" });
    }, 5000);
    child.stdout.on("data", chunk => { output = (output + chunk.toString()).slice(-8000); });
    child.stderr.on("data", () => {});
    child.once("error", () => finish({ placed: false, reason: "placement_unavailable" }));
    child.once("close", code => {
      if (code !== 0) return finish({ placed: false, reason: "placement_unavailable" });
      try { finish(JSON.parse(output.trim().split(/\\r?\\n/).at(-1))); }
      catch { finish({ placed: false, reason: "invalid_placement_result" }); }
    });
  });
}

async function browserCall(root, args) {
  if (args.operation === "status") return { ok: !!BROWSER_BIN, operation: "browser.status", ready: !!BROWSER_BIN, metadata: { executable: BROWSER_BIN, headless: true, transport: "cdp", foreground_fallback: true } };
  if (args.operation === "open_foreground") {
    if (args.foreground_control !== true) throw new Error("foreground_control=true is required for foreground browser fallback");
    if (!BROWSER_BIN) return { ok: false, operation: "browser.open_foreground", error_class: "unavailable", error_detail: "No supported Chromium browser found", retryable: true };
    const url = browserUrl(args.url);
    const existingWindows = snapshotBrowserWindows();
    const child = spawn(BROWSER_BIN, [url], { detached: true, stdio: "ignore", windowsHide: false });
    child.unref();
    const placement = await placeNewBrowserWindow(existingWindows, child.pid);
    return { ok: true, operation: "browser.open_foreground", metadata: { url, executable: BROWSER_BIN, foreground: true, placement } };
  }
  if (args.operation === "read_foreground_text") {
    const value = foregroundPageText(args);
    if (!value.text.trim()) return { ok: false, operation: "browser.read_foreground_text", failure: "empty_capture", reason: "The foreground Edge page did not yield readable text; select the page content and retry.", metadata: { foreground: true, clipboard_restored: true, total_chars: 0 } };
    return { ok: true, operation: "browser.read_foreground_text", metadata: { foreground: true, clipboard_restored: true, total_chars: value.total_chars, truncated: value.truncated }, output: value.text };
  }
  if (!BROWSER_BIN) return { ok: false, operation: `browser.${args.operation}`, error_class: "unavailable", error_detail: "No supported Chromium browser found", retryable: true };
  const url = browserUrl(args.url);
  const waitMs = Math.max(0, Math.min(30000, Number(args.wait_ms ?? 5000)));
  if (args.operation === "dump_dom") {
    const value = await browserDumpDom({ root, browserBin: BROWSER_BIN, url, reuseSession: true, maxChars: Math.max(1000, Math.min(120000, Number(args.max_chars || 30000))) });
    const block = browserBlockSignal(value.dom);
    const result = compact({ ok: true, output: JSON.stringify({ url, ...value, headless: true, transport: "cdp", ...block }) }, "browser.dump_dom");
    result.metadata = { ...(result.metadata || {}), ...block };
    return result;
  }
  if (["inspect", "click", "fill", "type"].includes(args.operation)) {
    if (!args.selector) throw new Error("selector is required");
    const shared = { root, browserBin: BROWSER_BIN, url, selector: args.selector, waitMs, reuseSession: true };
    let value;
    if (args.operation === "inspect") value = await browserInspect(shared);
    if (args.operation === "click") value = await browserClick(shared);
    if (args.operation === "fill") value = await browserFill({ ...shared, text: args.text || "" });
    if (args.operation === "type") value = await browserType({ ...shared, text: args.text || "" });
    return compact({ ok: true, output: JSON.stringify({ url, ...value, headless: true, transport: "cdp" }) }, `browser.${args.operation}`);
  }
  if (args.operation === "screenshot") {
    const outputPath = browserArtifactPath(root, args.output_path || path.join("work", "mouse-hole", `browser-${Date.now()}.png`));
    const shot = await browserScreenshot({ root, browserBin: BROWSER_BIN, url, reuseSession: true, outputPath, width: Math.max(320, Math.min(3840, Number(args.width || 1440))), height: Math.max(240, Math.min(2160, Number(args.height || 1000))) });
    const raw = await computerCall(root, "hanako_read_file", { path: `image://${shot.outputPath}` });
    return { ...compact(raw, "browser.screenshot"), path: shot.outputPath, metadata: { url, bytes: shot.size, headless: true } };
  }
  throw new Error("Unsupported browser operation");
}

async function comfyRequest(endpoint, { method = "GET", body, timeoutMs = 10000 } = {}) {
  const response = await fetch(`${COMFYUI_URL}${endpoint}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let value = {};
  if (text) {
    try { value = JSON.parse(text); } catch { throw new Error(`ComfyUI returned invalid JSON (${response.status})`); }
  }
  if (!response.ok) throw new Error(`ComfyUI API returned HTTP ${response.status}`);
  return value;
}

const COMFY_RUNNING = new Set(["pending", "queued", "in_progress", "running"]);

function comfyState(status) {
  if (["completed", "finished", "success", "succeeded"].includes(status)) return "finished";
  if (["failed", "error"].includes(status)) return "failed";
  if (status === "cancelled" || status === "canceled") return "cancelled";
  if (COMFY_RUNNING.has(status)) return "running";
  return "unknown";
}

function comfyJobResult(operation, jobId, data, state, extras = {}) {
  const status = String(data?.status || "unknown");
  const preview = data?.preview_output;
  const previewOutput = preview && typeof preview === "object" ? Object.fromEntries(["filename", "subfolder", "type"].filter(key => preview[key] !== undefined).map(key => [key, String(preview[key]).slice(0, 300)])) : undefined;
  const metadata = { job_id: String(jobId), state, status, outputs_count: Number(data?.outputs_count || 0), previewable_outputs_count: Number(data?.previewable_outputs_count || 0), ...(previewOutput ? { preview_output: previewOutput } : {}), ...extras };
  if (state === "failed") {
    const failure = data?.execution_error || {};
    const detail = String(failure.exception_message || "ComfyUI generation failed").slice(0, 1000);
    return { ok: false, operation, metadata: { ...metadata, error_node: String(failure.node_type || "").slice(0, 120), error_message: detail }, error_class: "backend_bug", error_detail: detail };
  }
  if (state === "cancelled") return { ok: false, operation, metadata, error_class: "cancelled", output: "ComfyUI generation cancelled" };
  if (state === "unknown") return { ok: false, operation, metadata, error_class: "unknown_state", error_detail: "ComfyUI returned an unrecognized job status" };
  if (state === "timeout") return { ok: true, operation, metadata, output: "Timed out observing ComfyUI; the job is still running" };
  return { ok: true, operation, metadata, output: state === "finished" ? "ComfyUI generation finished" : `ComfyUI job ${status}` };
}

async function observeComfyJob(jobId, waitMs = 0, pollIntervalMs = 500) {
  const deadline = Date.now() + waitMs;
  let data;
  while (true) {
    data = await comfyRequest(`/api/jobs/${jobId}`, { timeoutMs: 10000 });
    const state = comfyState(String(data?.status || "unknown"));
    if (state !== "running") return { data, state };
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { data, state: waitMs > 0 ? "timeout" : "running" };
    await new Promise(resolve => setTimeout(resolve, Math.min(pollIntervalMs, remaining)));
  }
}

function comfyWaitOptions(args, defaultWaitMs = 0) {
  const waitMs = args.wait_ms === undefined ? defaultWaitMs : Number(args.wait_ms);
  const pollIntervalMs = args.poll_interval_ms === undefined ? 500 : Number(args.poll_interval_ms);
  if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 30000) throw new Error("wait_ms must be an integer from 0 to 30000");
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 100 || pollIntervalMs > 5000) throw new Error("poll_interval_ms must be an integer from 100 to 5000");
  return { waitMs, pollIntervalMs };
}

async function comfyCall(args) {
  const operation = args.operation;
  if (operation === "workflow_validate") {
    const workflow = args.workflow;
    if (!workflow || typeof workflow !== "object" || Array.isArray(workflow) || !Object.keys(workflow).length) throw new Error("workflow must be a non-empty object");
    const invalid = Object.entries(workflow).filter(([, node]) => !node || typeof node !== "object" || typeof node.class_type !== "string").map(([id]) => id).slice(0, 20);
    if (invalid.length) return { ok: false, operation: "comfyui.workflow_validate", metadata: { invalid_nodes: invalid }, error_class: "validation_failed", error_detail: "Workflow nodes require class_type" };
    return { ok: true, operation: "comfyui.workflow_validate", metadata: { nodes: Object.keys(workflow).length }, output: "Workflow structure is valid" };
  }
  if (operation === "status") {
    const stats = await comfyRequest("/api/system_stats", { timeoutMs: 10000 });
    return { ok: true, operation: "comfyui.status", metadata: { url: COMFYUI_URL, comfyui_version: stats?.system?.comfyui_version, device_count: Array.isArray(stats?.devices) ? stats.devices.length : 0 } };
  }
  if (operation === "generate") {
    if (!args.workflow || typeof args.workflow !== "object" || !Object.keys(args.workflow).length) throw new Error("workflow must be a non-empty object");
    const data = await comfyRequest("/api/prompt", { method: "POST", body: { prompt: args.workflow, ...(args.client_id ? { client_id: String(args.client_id) } : {}) }, timeoutMs: 20000 });
    const jobId = data?.prompt_id;
    if (!jobId) throw new Error("ComfyUI did not return prompt_id");
    return { ok: true, operation: "comfyui.generate", metadata: { job_id: String(jobId) }, output: "ComfyUI generation started" };
  }
  if (!["job_status", "cancel", "output_resolve"].includes(operation)) throw new Error("Unsupported ComfyUI operation");
  if (!args.job_id) throw new Error("job_id is required");
  const jobId = encodeURIComponent(String(args.job_id));
  if (operation === "cancel") {
    const { waitMs, pollIntervalMs } = comfyWaitOptions(args, 3000);
    let accepted = false;
    let cancelError;
    try {
      const value = await comfyRequest(`/api/jobs/${jobId}/cancel`, { method: "POST", body: {}, timeoutMs: 10000 });
      accepted = value?.cancelled === true;
    } catch (error) { cancelError = String(error?.message || error).slice(0, 300); }
    try {
      const observed = await observeComfyJob(jobId, waitMs, pollIntervalMs);
      if (observed.state === "timeout" || observed.state === "running") {
        const result = comfyJobResult("comfyui.cancel", args.job_id, observed.data, accepted ? "cancel_requested" : "running", { cancel_requested: accepted, observed_state: observed.state });
        result.output = accepted ? "Cancellation requested; ComfyUI still reports the job running" : "Cancellation was not confirmed; ComfyUI still reports the job running";
        if (cancelError) result.error_detail = cancelError;
        return result;
      }
      const result = comfyJobResult("comfyui.cancel", args.job_id, observed.data, observed.state, { cancel_requested: accepted });
      if (cancelError) result.error_detail = cancelError;
      return result;
    } catch (error) {
      const detail = String(error?.message || error).slice(0, 500);
      return { ok: false, operation: "comfyui.cancel", metadata: { job_id: String(args.job_id), state: "unknown", status: "unknown", cancel_requested: accepted }, error_class: "unknown_state", error_detail: cancelError ? `${cancelError}; status check failed: ${detail}` : detail };
    }
  }
  const { waitMs, pollIntervalMs } = comfyWaitOptions(args);
  const observed = await observeComfyJob(jobId, waitMs, pollIntervalMs);
  return comfyJobResult(operation === "output_resolve" ? "comfyui.output_resolve" : "comfyui.job_status", args.job_id, observed.data, observed.state);
}

function guiKeyToken(key, modifiers = []) {
  const normal = new Set(["A", "C", "V", "X", "Y", "Z"]);
  const special = new Set(["ENTER", "TAB", "ESC", "BACKSPACE", "DELETE", "UP", "DOWN", "LEFT", "RIGHT", "HOME", "END", "PAGEUP", "PAGEDOWN", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"]);
  const token = key === "SPACE" ? " " : normal.has(key) ? key.toLowerCase() : special.has(key) ? `{${key}}` : null;
  if (!token) throw new Error("Unsupported GUI key");
  return [...new Set(modifiers)].map(modifier => ({ CTRL: "^", ALT: "%", SHIFT: "+" })[modifier]).join("") + token;
}

function systemJson(ps, timeoutMs = 15000) {
  const child = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps], { encoding: "utf8", windowsHide: true, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(String(child.stderr || child.stdout || "System diagnostic failed").slice(-1500));
  const text = String(child.stdout || "").trim();
  if (!text) return null;
  return JSON.parse(text);
}

function psString(value) {
  return "'" + String(value ?? "").replaceAll("'", "''") + "'";
}

function systemCall(args) {
  const operation = args.operation;
  const limit = Math.max(1, Math.min(200, Number(args.limit || 50)));
  if (operation === "process_list") {
    const filter = args.name ? ` | Where-Object { $_.ProcessName -like ${psString(`*${args.name}*`)} }` : "";
    const data = systemJson(`Get-Process${filter} | Sort-Object CPU -Descending | Select-Object -First ${limit} Id,ProcessName,CPU,WorkingSet64,MainWindowTitle | ConvertTo-Json -Compress -Depth 3`);
    return { ok: true, operation: "system.process_list", metadata: { limit }, data: data ?? [] };
  }
  if (operation === "service_status") {
    if (!args.name) throw new Error("name is required for service_status");
    const data = systemJson(`Get-Service -Name ${psString(args.name)} -ErrorAction SilentlyContinue | Select-Object Name,DisplayName,Status,StartType | ConvertTo-Json -Compress -Depth 3`);
    return { ok: true, operation: "system.service_status", data: data ?? null };
  }
  if (operation === "port_status") {
    if (!Number.isInteger(args.port)) throw new Error("port is required for port_status");
    const data = systemJson(`Get-NetTCPConnection -LocalPort ${args.port} -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,@{Name='State';Expression={$_.State.ToString()}},OwningProcess | ConvertTo-Json -Compress -Depth 3`);
    return { ok: true, operation: "system.port_status", metadata: { port: args.port }, data: data ?? [] };
  }
  if (operation === "startup_list") {
    const data = systemJson(`Get-CimInstance Win32_StartupCommand | Select-Object -First ${limit} Name,Command,Location,User | ConvertTo-Json -Compress -Depth 3`, 20000);
    return { ok: true, operation: "system.startup_list", metadata: { limit }, data: data ?? [] };
  }
  if (operation === "power_status") {
    const battery = systemJson(`Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object BatteryStatus,EstimatedChargeRemaining,EstimatedRunTime | ConvertTo-Json -Compress -Depth 3`);
    const scheme = spawnSync("powercfg.exe", ["/GETACTIVESCHEME"], { encoding: "utf8", windowsHide: true, timeout: 10000, maxBuffer: 256 * 1024 });
    const activeSchemeText = String(scheme.stdout || "").trim();
    const activeSchemeGuid = activeSchemeText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] || null;
    return { ok: true, operation: "system.power_status", data: { battery: battery ?? null, active_scheme_guid: activeSchemeGuid } };
  }
  if (operation === "gpu_status") {
    const data = systemJson(`Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,CurrentHorizontalResolution,CurrentVerticalResolution | ConvertTo-Json -Compress -Depth 3`, 20000);
    return { ok: true, operation: "system.gpu_status", data: data ?? [] };
  }
  throw new Error("Unsupported system diagnostic operation");
}

async function launchOwnedGui(args) {
  const executable = String(args.executable || "").trim();
  const argumentsText = String(args.arguments || "");
  if (!path.isAbsolute(executable) || path.extname(executable).toLowerCase() !== ".exe" ||
      !fs.existsSync(executable) || !fs.statSync(executable).isFile()) {
    throw new Error("gui.launch requires an existing absolute .exe path");
  }
  if (argumentsText.length > 4000 || /[\r\n\0]/.test(argumentsText)) {
    throw new Error("Invalid GUI launch arguments");
  }
  const psArgs = ["-NoProfile", "-NonInteractive", "-Sta", "-ExecutionPolicy", "Bypass",
    "-File", GUI_PLACEMENT_SCRIPT, "-Mode", "launch", "-Executable", executable,
    "-Arguments", argumentsText, "-WaitMs", "2200"];
  const output = await new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", psArgs, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err); else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("GUI launch result unknown (timeout); inspect windows before retrying"));
    }, 12000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", part => { stdout = (stdout + part).slice(-12000); });
    child.stderr.on("data", part => { stderr = (stderr + part).slice(-3000); });
    child.once("error", err => finish(err));
    child.once("close", code => {
      if (code !== 0) finish(new Error(String(stderr || stdout || "GUI launcher failed").slice(-1200)));
      else finish(null, stdout);
    });
  });
  const lastLine = String(output).trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!lastLine) throw new Error("GUI launcher returned no placement receipt");
  const receipt = JSON.parse(lastLine);
  return { ok: receipt.ok === true, operation: "gui.launch",
    metadata: { foreground_required: true, backend: "owned_window_placement",
      launched_pid: receipt.launched_pid || null, placement: receipt } };
}

async function guiCall(args) {
  const passive = new Set(["status", "wait"]);
  if (!passive.has(args.operation) && args.foreground_control !== true) throw new Error("foreground_control=true is required for GUI actuation");
  if (args.operation === "launch") return launchOwnedGui(args);
  // Native semantic actions can target one exact Win32/WinForms button without
  // requiring foreground ownership or moving the physical cursor. Never fall
  // back silently to a coordinate click when a semantic target is unsupported.
  const semanticButton = args.operation === "click" && typeof args.text === "string" && args.text.trim().length > 0;
  if (semanticButton && (!args.title || args.text.length > 512)) throw new Error("Exact window title and native button caption required");
  const psArgs = ["-NoProfile", "-NonInteractive", "-Sta", "-ExecutionPolicy", "Bypass", "-File", GUI_SCRIPT, "-Operation", args.operation];
  const push = (flag, value) => { if (value !== undefined && value !== null) psArgs.push(flag, String(value)); };
  for (const [key, flag] of [["x", "-X"], ["y", "-Y"], ["x2", "-X2"], ["y2", "-Y2"], ["delta", "-Delta"], ["text", "-Text"], ["title", "-Title"], ["duration_ms", "-DurationMs"]]) push(flag, args[key]);
  if (["key_press", "hotkey"].includes(args.operation)) {
    if (!args.key) throw new Error("key is required");
    push("-Keys", guiKeyToken(args.key, args.operation === "hotkey" ? (args.modifiers || []) : []));
  }
  const budget = semanticButton ? 4500 : args.operation === "wait" ? Math.min(35000, Number(args.duration_ms || 0) + 5000) : 15000;
  const childResult = await new Promise((resolve, reject) => {
    const command = semanticButton ? (process.env.HANAKO_PYTHON || "python") : "powershell.exe";
    const launchArgs = semanticButton ? ["-u", GUI_NATIVE_BUTTON_SCRIPT, "--title", args.title, "--text", args.text] : psArgs;
    const child = spawn(command, launchArgs, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err); else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("GUI operation timed out"));
    }, budget);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      stdout += chunk;
      if (stdout.length > 1024 * 1024) { child.kill(); finish(new Error("GUI output exceeded size limit")); }
    });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-3000); });
    child.once("error", error => finish(error));
    child.once("close", code => {
      if (code !== 0) finish(new Error(String(stderr || stdout || "GUI backend failed").slice(-1000)));
      else finish(null, stdout);
    });
  });
  const line = String(childResult || "").trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) throw new Error("GUI backend returned no result");
  const payload = JSON.parse(line);
  return { ok: payload.ok === true, operation: `gui.${args.operation}`, metadata: { state: payload.state || null, foreground_required: !passive.has(args.operation), backend: payload.semantic_backend || "guarded_powershell", ...(semanticButton ? {action_ms:payload.action_ms,cursor_unchanged:payload.cursor_unchanged,message_delivered:payload.message_delivered,target_foreground:payload.target_foreground,control_handle:payload.control_handle} : {}) } };
}

/** Isolated, bounded commands never read a shared Desktop Commander process-output buffer. */
function resolveBoundedCwd(root, requested) {
  const base = fs.realpathSync.native(root);
  const resolved = fs.realpathSync.native(path.resolve(base, requested || "."));
  const relative = path.relative(base, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || isDeniedPath(relative)) {
    throw new Error("Command cwd must remain inside the workspace");
  }
  return resolved;
}

async function runBoundedDirect(root, args = {}) {
  commandAllowed(args.command);
  const command = String(args.command);
  const cwd = resolveBoundedCwd(root, args.cwd);
  const budget = Math.max(1000, Math.min(Number(args.timeout_ms) || 10000, 30000));
  const started = Date.now();
  return await new Promise(resolve => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout = (stdout + chunk).slice(-12000); });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-4000); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, budget);
    const finish = (code, cause) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const ok = !timedOut && !cause && code === 0;
      const output = [stdout, stderr && `[stderr]\n${stderr}`].filter(Boolean).join("\n").slice(-12000);
      resolve({
        ok, operation: "run", process_id: child.pid ?? null, running: false,
        exit_code: Number.isInteger(code) ? code : null,
        command_summary: command.slice(0, 160), output,
        metadata: { executor: "isolated_powershell", duration_ms: Date.now() - started, timeout_ms: budget },
        ...(!ok ? {
          failure: timedOut ? "timeout" : cause ? "spawn_error" : "exit_nonzero",
          reason: timedOut ? "Bounded command timed out; child processes may still require inspection" : cause ? String(cause.message || cause) : `Command exited with code ${code}`,
        } : {}),
      });
    };
    child.on("error", cause => finish(null, cause));
    child.on("close", code => finish(code));
  });
}

export function createMouseHoleCore({ call = computerCall, diagnose = systemCall, constructionContext = createConstructionContext() } = {}) {
  const useNativeFiles = call === computerCall;
  return async function mouseHoleCoreCall(root, name, args = {}) {
    const invoke = async (legacyName, payload = args, operation = name) => compact(await call(root, legacyName, payload), operation);
    if (name === "mouse_hole_status") {
      const base = {
        ok: true,
        operation: "status",
        ready: true,
        schema_fingerprint: MOUSE_HOLE_SCHEMA_FINGERPRINT,
        capabilities: ["construction", "read", "write", "patch", "search", "run", "process", "git", "validate", "blender", "godot", "comfyui", "browser", "observe", "gui"],
        version: MICE_HOLE_VERSION,
        construction_io: "read construction://status|continue?project=<path>; write construction://start|checkpoint|continue|resume|finish",
      };
      const detail = args.detail || "runtime";
      if (detail === "runtime") return base;
      const map = { processes: "process_list", service: "service_status", port: "port_status", startup: "startup_list", power: "power_status", gpu: "gpu_status" };
      let diagnostic;
      try { diagnostic = diagnose({ ...args, operation: map[detail] }); }
      catch (error) { diagnostic = { data: { available: false, reason: 'diagnostic_probe_failed', error: String(error.code || error.message).slice(0, 500) } }; }
      return { ok: true, operation: "status", ready: true, capabilities: base.capabilities, detail, data: diagnostic.data, ...(diagnostic.metadata && Object.keys(diagnostic.metadata).length ? { metadata: diagnostic.metadata } : {}) };
    }
    if (name === "mouse_hole_read") {
      if (typeof args.path === "string" && args.path.startsWith("construction://")) {
        const uri = new URL(args.path);
        if (!["status", "continue"].includes(uri.hostname) || uri.pathname || [...uri.searchParams.keys()].some(key => !["project", "cwd"].includes(key))) throw new Error("Unsupported construction read path");
        const result = constructionCall(root, { operation: "status", ...(uri.searchParams.has("project") ? { project: uri.searchParams.get("project") } : {}), ...(uri.searchParams.has("cwd") ? { cwd: uri.searchParams.get("cwd") } : {}) }, constructionContext);
        if (uri.hostname === "continue" && result.construction?.project_root) result.continuation = {
          project_root: result.construction.project_root, phase: result.construction.current_phase,
          checkpoint: result.construction.checkpoint, next_action: result.construction.next_action,
          files: result.construction.files,
          instruction: "Use construction://continue to reactivate this project, then execute its next authorized step. If a human gate is pending, report it and keep the gate." };
        return result;
      }
      if (useNativeFiles) {
        const direct = nativeRead(root, args);
        if (direct) return compact(direct, "read");
      }
      return invoke("hanako_read_file", args, "read");
    }
    if (name === "mouse_hole_write") {
      const prefix = "construction://";
      if (typeof args.path === "string" && args.path.startsWith(prefix)) {
        const operation = args.path.slice(prefix.length);
        if (!["start", "checkpoint", "continue", "resume", "finish"].includes(operation)) throw new Error("Unsupported construction control path");
        let payload = {};
        try { payload = args.content ? JSON.parse(args.content) : {}; }
        catch { throw new Error("construction control content must be a JSON object"); }
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("construction control content must be a JSON object");
        return constructionCall(root, { ...payload, operation }, constructionContext);
      }
      if (useNativeFiles) {
        const direct = nativeWrite(root, args);
        if (direct) return compact(direct, "write");
      }
      return invoke("hanako_write_file", args, "write");
    }
    if (name === "mouse_hole_patch") {
      if (useNativeFiles) {
        const direct = nativePatch(root, args);
        if (direct) return compact(direct, "patch");
      }
      return invoke("hanako_edit_file", args, "patch");
    }
    if (name === "mouse_hole_search") {
      if (useNativeFiles) return compact(await nativeSearch(root, args), "search");
      try { return await invoke("hanako_search", { ...args, search_type: args.search_type || "content" }, "search"); }
      catch (error) {
        if (!isRipgrepUnavailable(error)) throw error;
        return fallbackSearch(root, args);
      }
    }
    if (name === "mouse_hole_run") return runBoundedDirect(root, args);
    if (name === "mouse_hole_validate") {
      const result = await invoke("hanako_validate", args, "validate");
      if (result.exit_code === 0) {
        result.summary = "Validation passed";
        delete result.output;
      } else if (result.exit_code !== undefined) {
        result.summary = `Validation failed with exit ${result.exit_code}`;
      }
      return result;
    }
    if (name === "mouse_hole_git") {
      if (useNativeFiles) {
        try { return compact(await nativeGit(root, args), `git.${args.operation}`); }
        catch (error) { if (error?.code !== "ENOENT") throw error; }
      }
      const legacy = args.operation === "status" ? "hanako_git_status" : "hanako_git_diff";
      return invoke(legacy, args, `git.${args.operation}`);
    }
    if (name === "mouse_hole_process") {
      if (args.operation === "wait") {
        if (!Number.isInteger(args.process_id)) throw new Error("process_id is required");
        const waitMs = Math.max(0, Math.min(30000, Number(args.wait_ms ?? args.timeout_ms ?? 15000)));
        const deadline = Date.now() + waitMs;
        let latest = await call(root, "hanako_process_output", { process_id: args.process_id, timeout_ms: Math.min(1000, Math.max(100, waitMs)), offset: args.offset, length: args.length });
        while (latest?.exit_code === undefined && latest?.exit_code !== 0 && Date.now() < deadline) {
          if (latest?.running === false || latest?.exit_code !== undefined) break;
          await new Promise(resolve => setTimeout(resolve, Math.min(1000, Math.max(50, deadline - Date.now()))));
          if (Date.now() >= deadline) break;
          latest = await call(root, "hanako_process_output", { process_id: args.process_id, timeout_ms: Math.min(1000, Math.max(100, deadline - Date.now())), offset: args.offset, length: args.length });
        }
        const result = compact(latest, "process.wait");
        result.metadata = { ...(result.metadata || {}), waited_ms: waitMs, terminal: result.exit_code !== undefined || result.running === false };
        return result;
      }
      const route = {
        start: ["hanako_start_process", { command: args.command, cwd: args.cwd, timeout_ms: args.timeout_ms }],
        status: ["hanako_process_status", { process_id: args.process_id }],
        output: ["hanako_process_output", { process_id: args.process_id, timeout_ms: args.timeout_ms, offset: args.offset, length: args.length }],
        stop: ["hanako_kill_process", { process_id: args.process_id }],
      }[args.operation];
      if (!route) throw new Error("Unsupported process operation");
      const result = await invoke(route[0], route[1], `process.${args.operation}`);
      if (args.operation === "start" && result.running === true && Number.isInteger(result.process_id)) delete result.output;
      if (args.operation === "status") delete result.output;
      if (args.operation === "stop" && result.ok) delete result.output;
      return result;
    }
    if (name === "mouse_hole_blender") {
      if (args.operation === "batch") {
        const steps = args.steps;
        if (!Array.isArray(steps) || steps.length < 1 || steps.length > 8) throw new Error("batch requires 1 to 8 steps");
        const results = [];
        for (const step of steps) {
          if (!step || !["normalize_mesh", "validate", "render_validation", "export_glb", "artifact_report"].includes(step.operation)) throw new Error("Unsupported Blender batch step");
          const raw = await runAdapterAsync(root, "blender", step.operation, { ...args, ...step }, 180000);
          const normalized = compactAdapter(raw, `blender.${step.operation}`);
          results.push(normalized);
          if (!normalized.ok) return { ok: false, operation: "blender.batch", results };
        }
        return { ok: true, operation: "blender.batch", results };
      }
      const raw = await runAdapterAsync(root, "blender", args.operation, args, args.operation === "render_validation" ? 180000 : 120000);
      return compactAdapter(raw, `blender.${args.operation}`);
    }
    if (name === "mouse_hole_godot") {
      const raw = await runAdapterAsync(root, "godot", args.operation, args, (args.timeout_seconds || 120) * 1000);
      return compactAdapter(raw, `godot.${args.operation}`);
    }
  if (name === "mouse_hole_comfyui") {
      const result = await comfyCall(args);
      const preview = result?.metadata?.preview_output;
      if (args.operation === "output_resolve" && preview?.filename) {
        const ext = path.extname(preview.filename).toLowerCase();
        const type = ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" })[ext] || "application/octet-stream";
        result.artifacts = [{ path: `comfyui://${encodeURIComponent(args.job_id)}/${encodeURIComponent(preview.subfolder || "")}/${encodeURIComponent(preview.filename)}`, type, source: "comfyui.output_resolve", validation: result.ok ? "PASS" : "FAIL" }];
      }
      return result;
    }
    if (name === "mouse_hole_browser") return browserCall(root, args);
    if (name === "mouse_hole_observe") {
      if (args.target === "image" && isPreviewMediaPath(args.path)) return observePreview(root,args);
      if (["screen","window"].includes(args.target) && isPreviewMediaPath(args.path)) {
        if (args.target==="window" && !args.title) throw new Error("Window title required");
        const virtual=args.target==="screen"?"screen://primary":`window://${args.title}`;
        const capture=await call(root,"hanako_read_file",{path:virtual});
        return observeCapturedPreview(root,args,capture);
      }
      if (args.target === "window" && !args.title) throw new Error("title is required for window observation");
      if (["image", "resource"].includes(args.target) && !args.path) throw new Error("path is required for image/resource observation");
      const virtual = args.target === "screen" ? "screen://primary" : args.target === "window" ? `window://${args.title || ""}` : `${args.target}://${args.path || ""}`;
      const raw = await call(root, "hanako_read_file", { path: virtual });
      return compact(raw, "observe");
    }
    if (name === "mouse_hole_gui") return guiCall(args);
    throw new Error(`Unsupported Mouse Hole core operation: ${name}`);
  };
}

export const mouseHoleConstructionContext = createConstructionContext();
export const mouseHoleCoreCall = createMouseHoleCore({ constructionContext: mouseHoleConstructionContext });
