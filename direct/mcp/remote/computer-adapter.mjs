/** Thin, persistent MCP client for the existing Desktop Commander backend. */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { isDeniedPath } from "./bridge-core.mjs";
import { updateJobByProcess } from "./job-core.mjs";

const DC_ROOT = process.env.HANAKO_DESKTOP_COMMANDER_ROOT || "E:\\CHATGPT\\work\\desktop-commander-bridge";
const STATE_NAME = "computer-context-v1.json";
let clientPromise;

function inside(root, value, mustExist = true) {
  const base = fs.realpathSync.native(root);
  const abs = path.resolve(path.isAbsolute(value) ? value : path.join(base, value));
  const existing = mustExist ? abs : fs.existsSync(abs) ? abs : path.dirname(abs);
  const real = fs.realpathSync.native(existing);
  const relReal = path.relative(base, real);
  const rel = path.relative(base, abs);
  if ([relReal, rel].some(x => x === ".." || x.startsWith(`..${path.sep}`) || path.isAbsolute(x))) {
    throw new Error("Path must remain inside the Hanako workspace");
  }
  if (isDeniedPath(relReal) || isDeniedPath(rel)) throw new Error("Credential-like path is unavailable");
  return abs;
}

function context(root) {
  const file = path.join(root, "work", "bridge", STATE_NAME);
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return { current_task_id: null, current_cwd: root, active_process_ids: [], last_validation_result: null, last_execution_summary: null }; }
}

function save(root, state) {
  const file = path.join(root, "work", "bridge", STATE_NAME);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}

async function backend() {
  if (!clientPromise) clientPromise = (async () => {
    const sdk = path.join(DC_ROOT, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm");
    const [{ Client }, { StdioClientTransport }] = await Promise.all([
      import(pathToFileURL(path.join(sdk, "client", "index.js")).href),
      import(pathToFileURL(path.join(sdk, "client", "stdio.js")).href),
    ]);
    const client = new Client({ name: "hanako-computer-adapter", version: "1.0.0" }, { capabilities: {} });
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [path.join(DC_ROOT, "dist", "index.js")],
      cwd: DC_ROOT,
      env: { ...process.env, DESKTOP_COMMANDER_DISABLE_TELEMETRY: "1" },
      stderr: "pipe",
    }));
    return client;
  })().catch(error => { clientPromise = null; throw error; });
  return clientPromise;
}

/** Close the Desktop Commander child owned by this adapter (used by standalone stdio hosts). */
export async function closeComputerAdapter() {
  const pending = clientPromise;
  clientPromise = null;
  if (!pending) return;
  const client = await pending.catch(() => null);
  if (client) await client.close();
}

/** MiceHole opts into no-replay mutations; existing Hanako behavior remains compatible. */
export async function requestWithRecovery({ name, request, recover, safeMode }) {
  const safeReads = new Set(["read_file", "read_process_output", "list_sessions", "list_processes", "get_more_search_results", "start_search"]);
  try { return await request(); }
  catch (firstError) {
    if (safeMode && !safeReads.has(name)) {
      const error = new Error(`Execution result unknown for ${name}; inspect actual state before retrying. The request was not replayed.`);
      error.code = "execution_unknown";
      error.cause = firstError;
      throw error;
    }
    await recover();
    try { return await request(); }
    catch (retryError) { retryError.cause = firstError; throw retryError; }
  }
}

async function dc(name, args) {
  const result = await requestWithRecovery({
    name,
    safeMode: process.env.MOUSE_HOLE_SAFE_RETRY === "1",
    request: async () => (await backend()).callTool({ name, arguments: args }, undefined, { timeout: 45_000 }),
    recover: async () => {
      const stale = clientPromise;
      clientPromise = null;
      if (stale) await stale.then(client => client?.close?.()).catch(() => {});
    },
  });
  const output = (result.content || []).filter(x => x.type === "text").map(x => x.text).join("\n");
  if (result.isError || /^Error:/i.test(output)) throw new Error(output.slice(0, 2000) || `${name} failed`);
  return output;
}

async function runBounded(cwd, command, timeoutMs) {
  const budget = Math.max(1000, Math.min(timeoutMs || 10000, 30000));
  const started = await dc("start_process", {
    command: shellCommand(cwd, command),
    timeout_ms: Math.min(1000, budget),
    shell: "powershell.exe",
  });
  if (/Process completed with exit code\s+-?\d+/i.test(started)) return { output: started, processId: null };
  const match = started.match(/(?:PID|pid)\s*[:=]?\s*(\d+)/);
  if (!match) throw new Error("Desktop Commander did not return a process ID for bounded execution");
  const processId = Number(match[1]);
  const deadline = Date.now() + budget;
  let latest = started;
  while (Date.now() < deadline) {
    const remaining = Math.max(100, Math.min(1000, deadline - Date.now()));
    latest = await dc("read_process_output", { pid: processId, timeout_ms: remaining, offset: 0, length: 2000 });
    if (/Process completed with exit code\s+-?\d+/i.test(latest)) return { output: latest, processId };
  }
  throw new Error(`FAST command exceeded ${budget}ms; use hanako_start_process for durable work`);
}

export function commandAllowed(command) {
  if (typeof command !== "string" || !command.trim()) throw new Error("command is required");

  // Match destructive command names only when they occupy a command position:
  // start-of-command, start-of-line, or immediately after a shell statement/pipeline separator.
  // Do NOT treat ordinary path/file words as executable names. For example, Kenney's
  // "Models\\GLTF format\\..." directory is a safe asset path, not the Windows FORMAT command.
  const destructiveCommand = /(?:^|[;|&]|\r?\n)\s*(?:(?:format(?:\.com)?)(?=\s|$)|(?:diskpart|clear-disk|set-mppreference|add-mppreference)\b)/i;

  const controlledSystemMutation =
    /(?:^|[;|&]|\r?\n)\s*(?:reg(?:\.exe)?\s+(?:add|delete)|set-itemproperty|new-itemproperty|remove-itemproperty|set-service|start-service|stop-service|restart-service|register-scheduledtask|unregister-scheduledtask|new-scheduledtask|schtasks(?:\.exe)?\s+\/(?:create|delete|change)|netsh\s+winhttp\s+(?:set|reset)\s+proxy)\b/i;
  const externalConfigMutation =
    /(?:set-content|add-content|out-file|remove-item|copy-item|move-item|rename-item|new-item|set-item)\b[^\r\n]*(?:\$env:appdata|%appdata%|\\AppData\\|\\AppData\/)/i;

  if (destructiveCommand.test(command) ||
      controlledSystemMutation.test(command) ||
      externalConfigMutation.test(command) ||
      /git\s+push\b[^\r\n]*--force(?:-with-lease)?\b/i.test(command) ||
      /(?:remove-item|rmdir|rd)\b[^\r\n]*E:[\\/]CHATGPT\s*(?:[;|]|$)/i.test(command)) {
    throw new Error("High-risk command requires a separate Human Gate");
  }
}

function shellCommand(cwd, command) {
  return `Set-Location -LiteralPath '${cwd.replaceAll("'", "''")}'; ${command}`;
}

function scrubSearch(root, output) {
  return output.split(/\r?\n/).filter(line => {
    if (!line.startsWith("📄 ") && !line.startsWith("📁 ")) return true;
    const found = line.startsWith("📄 ") ? line.match(/^📄 (.*):\d+ - /)?.[1] : line.slice(3);
    if (!found) return false;
    try { inside(root, found); return true; } catch { return false; }
  }).join("\n");
}

const IMAGE_MIME = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

function mediaBlock(file, imageOnly = false) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error("Media path must be a file");
  if (stat.size > MAX_MEDIA_BYTES) throw new Error("Media file exceeds bridge size limit");
  const ext = path.extname(file).toLowerCase();
  const mimeType = IMAGE_MIME.get(ext) || "application/octet-stream";
  if (imageOnly && !IMAGE_MIME.has(ext)) throw new Error("hanako_read_image supports PNG, JPEG, WebP, and GIF only");
  const data = fs.readFileSync(file).toString("base64");
  const content = imageOnly
    ? [{ type: "image", data, mimeType }]
    : [{ type: "resource", resource: { uri: pathToFileURL(file).href, mimeType, blob: data } }];
  return {
    metadata: { ok: true, path: file, name: path.basename(file), mime_type: mimeType, size_bytes: stat.size },
    content,
  };
}

function psQuote(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}

function runFixedPowerShell(script) {
  const child = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8", windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024,
  });
  if (child.error || child.status !== 0) {
    throw new Error((child.stderr || child.stdout || child.error?.message || "fixed PowerShell action failed").slice(0, 2000));
  }
  return child.stdout || "";
}

const MAINTENANCE_COMMANDS = new Map([
  ["hanako maintenance status", "status"],
  ["hanako maintenance restart-supervisor", "restart-supervisor"],
  ["hanako maintenance restart-b2-consumer", "restart-b2-consumer"],
  ["hanako maintenance restart-tunnel", "restart-tunnel"],
]);

export function maintenanceAction(command) {
  if (typeof command !== "string") return null;
  return MAINTENANCE_COMMANDS.get(command.trim()) || null;
}

function runMaintenanceAction(root, action) {
  const supervisorDir = path.join(root, "work", "b-route", "supervisor");
  const supervisor = path.join(supervisorDir, "hanako-supervisor.ps1");
  const health = path.join(supervisorDir, "health-check.ps1");

  if (action === "status") {
    if (!fs.existsSync(health)) throw new Error("Hanako health-check script is missing");
    return runFixedPowerShell("& " + psQuote(health));
  }

  if (action === "restart-supervisor") {
    if (!fs.existsSync(supervisor)) throw new Error("Hanako supervisor script is missing");
    const script = [
      "$target=" + psQuote(supervisor),
      "$matches=@(Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*hanako-supervisor.ps1*' -and $_.CommandLine -notlike '*-Once*' })",
      "if($matches.Count -gt 1){ throw ('Refusing restart: found '+$matches.Count+' continuous Hanako supervisors') }",
      "if($matches.Count -eq 1){ Stop-Process -Id $matches[0].ProcessId -Force -ErrorAction Stop; Write-Output ('stopped_supervisor_pid='+$matches[0].ProcessId) }",
      "Start-Process -WindowStyle Hidden -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$target)",
      "Write-Output 'maintenance=restart-supervisor ok=true'",
    ].join("; ");
    return runFixedPowerShell(script);
  }

  if (action === "restart-b2-consumer") {
    const script = [
      "Get-Service -Name 'OpenHanakoB2Consumer' -ErrorAction Stop | Out-Null",
      "Restart-Service -Name 'OpenHanakoB2Consumer' -Force -ErrorAction Stop",
      "Write-Output 'maintenance=restart-b2-consumer ok=true service=OpenHanakoB2Consumer'",
    ].join("; ");
    return runFixedPowerShell(script);
  }

  if (action === "restart-tunnel") {
    const script = [
      "$p=@(Get-CimInstance Win32_Process -Filter \"Name='tunnel-client.exe'\" | Where-Object { $_.CommandLine -match '--profile\\s+\\\"?hanako-b0\\\"?(?:\\s|$)' })",
      "if($p.Count -gt 1){ throw ('Refusing restart: found '+$p.Count+' hanako-b0 tunnel-client processes') }",
      "if($p.Count -eq 1){ Stop-Process -Id $p[0].ProcessId -Force -ErrorAction Stop; Write-Output ('stopped_tunnel_pid='+$p[0].ProcessId) }",
      "Write-Output 'maintenance=restart-tunnel ok=true owner=b0-daemon profile=hanako-b0'",
    ].join("; ");
    return runFixedPowerShell(script);
  }

  throw new Error("Unknown Hanako maintenance action");
}

function capturePath(root, stem) {
  const dir = path.join(root, "work", "bridge", "captures");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, stem + "-" + Date.now() + ".png");
}

function captureScreen(root) {
  const out = capturePath(root, "screen");
  const dpiAware = 'using System; using System.Runtime.InteropServices; public static class HDPI { [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext); }';
  const script = "Add-Type -TypeDefinition " + psQuote(dpiAware) + "; [void][HDPI]::SetProcessDpiAwarenessContext([IntPtr](-4)); Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($bmp); try { $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save(" + psQuote(out) + ",[System.Drawing.Imaging.ImageFormat]::Png) } finally { $g.Dispose(); $bmp.Dispose() }";
  runFixedPowerShell(script);
  return mediaBlock(out, true);
}

function captureWindow(root, titleContains) {
  const needle = String(titleContains || "Godot").trim();
  if (!needle) throw new Error("title_contains must not be empty");
  const out = capturePath(root, "window");
  const csharp = 'using System; using System.Runtime.InteropServices; public static class HW { [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; } [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext); [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect); }';
  const script = "Add-Type -AssemblyName System.Drawing; Add-Type -TypeDefinition " + psQuote(csharp) + "; [void][HW]::SetProcessDpiAwarenessContext([IntPtr](-4)); $p=Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like " + psQuote("*" + needle + "*") + " } | Select-Object -First 1; if(-not $p){ throw \"No matching window\" }; $r=New-Object HW+RECT; [HW]::GetWindowRect($p.MainWindowHandle,[ref]$r) | Out-Null; $w=$r.Right-$r.Left; $h=$r.Bottom-$r.Top; if($w -le 0 -or $h -le 0){ throw \"Invalid window bounds\" }; $bmp=New-Object System.Drawing.Bitmap $w,$h; $g=[System.Drawing.Graphics]::FromImage($bmp); try { $g.CopyFromScreen((New-Object System.Drawing.Point($r.Left,$r.Top)),[System.Drawing.Point]::Empty,(New-Object System.Drawing.Size($w,$h))); $bmp.Save(" + psQuote(out) + ",[System.Drawing.Imaging.ImageFormat]::Png) } finally { $g.Dispose(); $bmp.Dispose() }";
  runFixedPowerShell(script);
  return mediaBlock(out, true);
}

export const COMPUTER_TOOLS = [
  ["hanako_read_file", "Read a workspace file through Desktop Commander", { path: { type: "string" }, offset: { type: "integer" }, length: { type: "integer" } }, ["path"], true],
  ["hanako_write_file", "Write a workspace file through Desktop Commander", { path: { type: "string" }, content: { type: "string" } }, ["path", "content"], false],
  ["hanako_edit_file", "Replace text in a workspace file through Desktop Commander", { path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" }, expected_replacements: { type: "integer" } }, ["path", "old_string", "new_string"], false],
  ["hanako_search", "Search workspace files through Desktop Commander", { path: { type: "string" }, pattern: { type: "string" }, search_type: { type: "string", enum: ["files", "content"] }, session_id: { type: "string" } }, [], true],
  ["hanako_run_command", "Run a command in a workspace directory through Desktop Commander", { command: { type: "string" }, cwd: { type: "string" }, timeout_ms: { type: "integer" } }, ["command"], false],
  ["hanako_start_process", "Start a persistent Desktop Commander process and return its PID", { command: { type: "string" }, cwd: { type: "string" }, timeout_ms: { type: "integer" } }, ["command"], false],
  ["hanako_process_output", "Read new output from a Desktop Commander process", { process_id: { type: "integer" }, timeout_ms: { type: "integer" }, offset: { type: "integer" }, length: { type: "integer" } }, ["process_id"], true],
  ["hanako_process_status", "Inspect Desktop Commander process sessions", { process_id: { type: "integer" } }, [], true],
  ["hanako_kill_process", "Terminate a Desktop Commander process", { process_id: { type: "integer" } }, ["process_id"], false],
  ["hanako_git_status", "Run git status in a workspace repository", { cwd: { type: "string" } }, [], true],
  ["hanako_git_diff", "Run git diff in a workspace repository", { cwd: { type: "string" }, path: { type: "string" } }, [], true],
  ["hanako_validate", "Run the repository validation command", { cwd: { type: "string" }, command: { type: "string" } }, [], false],
  ["hanako_godot", "Run typed Godot operations or the legacy raw headless args route", { cwd: { type: "string" }, args: { type: "string" }, operation: { type: "string", enum: ["project_status", "validate_project", "import_check", "run_scene"] }, scene: { type: "string" }, timeout_ms: { type: "integer" } }, [], false],
].map(([name, description, properties, required, readOnlyHint]) => ({
  name, description,
  inputSchema: { type: "object", properties: { ...properties, task_id: { type: "string", description: "Optional current Hanako task id for continuation context" } }, required, additionalProperties: false },
  annotations: { readOnlyHint, destructiveHint: false, openWorldHint: false },
}));

export async function computerCall(root, name, args = {}) {
  const state = context(root);
  if (args.task_id) state.current_task_id = String(args.task_id).slice(0, 120);
  const cwd = inside(root, args.cwd || state.current_cwd || root);
  const rawPath = args.path == null ? null : String(args.path);
  const isReadFile = name === "hanako_read_file";
  const virtualScreen = isReadFile && rawPath === "screen://primary";
  const virtualWindow = isReadFile && rawPath?.startsWith("window://");
  const virtualImage = isReadFile && rawPath?.startsWith("image://");
  const virtualResource = isReadFile && rawPath?.startsWith("resource://");
  const physicalPath = virtualImage ? rawPath.slice("image://".length)
    : virtualResource ? rawPath.slice("resource://".length)
    : (virtualScreen || virtualWindow ? null : rawPath);
  const file = physicalPath ? inside(root, physicalPath, name !== "hanako_write_file") : null;
  let output = "";
  let processId = null;
  let commandSummary = null;
  let richContent = null;
  let mediaMeta = null;
  if (name === "hanako_run_command") {
    const maintenance = maintenanceAction(args.command);
    if (maintenance) {
      const command = String(args.command).trim();
      output = runMaintenanceAction(root, maintenance);
      commandSummary = command;
      state.current_cwd = cwd;
      state.last_execution_summary = {
        tool: name,
        cwd,
        command_sha256: createHash("sha256").update(command).digest("hex"),
        process_id: null,
        maintenance_action: maintenance,
        timestamp: new Date().toISOString(),
      };
      save(root, state);
      return {
        ok: true,
        tool: name,
        cwd,
        command_summary: command,
        maintenance_action: maintenance,
        output: String(output || "").slice(0, 100_000),
        context: {
          current_task_id: state.current_task_id,
          current_cwd: state.current_cwd,
          active_process_ids: state.active_process_ids,
          last_validation_result: state.last_validation_result,
          last_execution_summary: state.last_execution_summary,
        },
      };
    }
  }
  if (name === "hanako_read_file" && virtualScreen) {
    const media = captureScreen(root); mediaMeta = media.metadata; richContent = media.content;
  } else if (name === "hanako_read_file" && virtualWindow) {
    const media = captureWindow(root, rawPath.slice("window://".length)); mediaMeta = media.metadata; richContent = media.content;
  } else if (name === "hanako_read_file" && virtualImage) {
    const media = mediaBlock(file, true); mediaMeta = media.metadata; richContent = media.content;
  } else if (name === "hanako_read_file" && virtualResource) {
    const media = mediaBlock(file, false); mediaMeta = media.metadata; richContent = media.content;
  } else if (name === "hanako_read_file" && file && IMAGE_MIME.has(path.extname(file).toLowerCase())) {
    const media = mediaBlock(file, true); mediaMeta = media.metadata; richContent = media.content;
  } else if (name === "hanako_read_file") output = await dc("read_file", { path: file, offset: args.offset, length: args.length });
  else if (name === "hanako_write_file") output = await dc("write_file", { path: file, content: args.content });
  else if (name === "hanako_edit_file") output = await dc("edit_block", { file_path: file, old_string: args.old_string, new_string: args.new_string, expected_replacements: args.expected_replacements ?? 1 });
  else if (name === "hanako_search") {
    if (args.session_id) output = await dc("get_more_search_results", { sessionId: args.session_id, offset: 0, length: 100 });
    else output = await dc("start_search", { path: inside(root, args.path || cwd), pattern: args.pattern, searchType: args.search_type || "content", maxResults: 100 });
    output = scrubSearch(root, output);
  } else if (name === "hanako_process_output") output = await dc("read_process_output", { pid: args.process_id, timeout_ms: Math.min(args.timeout_ms || 1000, 30_000), offset: args.offset || 0, length: args.length || 200 });
  else if (name === "hanako_process_status") output = await dc("list_sessions", {});
  else if (name === "hanako_kill_process") {
    output = await dc("force_terminate", { pid: args.process_id });
    state.active_process_ids = state.active_process_ids.filter(id => id !== args.process_id);
    const job = updateJobByProcess(root, args.process_id, {
      state: "CANCELLED", error_class: "cancelled", finished_at: new Date().toISOString(), summary: "process cancelled",
    });
    // Resource ownership is managed by the typed adapter; process control only updates Job evidence.
  } else {
    let command = args.command;
    if (name === "hanako_git_status") command = "git status --short --branch";
    if (name === "hanako_git_diff") command = `git diff -- ${args.path ? `'${path.relative(cwd, inside(root, args.path)).replaceAll("'", "''")}'` : "."}`;
    if (name === "hanako_validate") command ||= "python tools/validation/run_engineering_suite.py";
    if (name === "hanako_godot") {
      const executable = process.env.GODOT_BIN || "D:\\Program Files\\AI_Tool\\Godot\\Godot_v4.7.2-stable_win64.exe";
      if (!fs.existsSync(executable)) throw new Error(`Godot executable not found: ${executable}`);
      let godotArgs = args.args || "--quit-after 1";
      if (args.operation) {
        if (!fs.existsSync(path.join(cwd, "project.godot"))) throw new Error("Godot project.godot not found in cwd");
        if (args.operation === "project_status") godotArgs = "--quit-after 1";
        else if (args.operation === "validate_project") godotArgs = "--editor --quit-after 1";
        else if (args.operation === "import_check") godotArgs = "--import";
        else if (args.operation === "run_scene") {
          if (!args.scene) throw new Error("scene is required for run_scene");
          const scene = inside(root, path.resolve(cwd, args.scene));
          const relScene = path.relative(cwd, scene);
          if (relScene === ".." || relScene.startsWith(`..${path.sep}`) || path.isAbsolute(relScene)) throw new Error("scene must remain inside the Godot project");
          godotArgs = `'${relScene.replaceAll("'", "''")}' --quit-after 1`;
        } else throw new Error("Unsupported Godot operation");
      }
      command = `& '${executable.replaceAll("'", "''")}' --headless --path . ${godotArgs}`;
    }
    commandAllowed(command);
    commandSummary = command.length > 160 ? `${command.slice(0, 160)}…` : command;
    if (name === "hanako_start_process") {
      output = await dc("start_process", { command: shellCommand(cwd, command), timeout_ms: Math.min(args.timeout_ms || 1000, 30_000), shell: "powershell.exe" });
      const match = output.match(/(?:PID|pid)\s*[:=]?\s*(\d+)/);
      processId = match ? Number(match[1]) : null;
      if (!processId) throw new Error("Desktop Commander did not return a stable process ID");
      if (!/Process completed/i.test(output) && !state.active_process_ids.includes(processId)) state.active_process_ids.push(processId);
    } else {
      const bounded = await runBounded(cwd, command, args.timeout_ms || 10_000);
      output = bounded.output;
      processId = bounded.processId;
    }
    state.current_cwd = cwd;
    state.last_execution_summary = { tool: name, cwd, command_sha256: createHash("sha256").update(command).digest("hex"), process_id: processId, timestamp: new Date().toISOString() };
    if (name === "hanako_validate" || name === "hanako_godot") state.last_validation_result = {
      tool: name, process_id: processId, output_sha256: createHash("sha256").update(output).digest("hex"), timestamp: new Date().toISOString(),
    };
  }
  const exit = String(output || "").match(/Process completed with exit code\s+(-?\d+)/i);
  const exitCode = exit ? Number(exit[1]) : null;
  const failed = (exitCode !== null && exitCode !== 0) || /CommandNotFoundException/.test(output);
  if (name === "hanako_process_output" && exitCode !== null) {
    state.active_process_ids = state.active_process_ids.filter(id => id !== args.process_id);
    state.last_validation_result = { process_id: args.process_id, exit_code: exitCode, timestamp: new Date().toISOString() };
    const job = updateJobByProcess(root, args.process_id, {
      state: exitCode === 0 ? "SUCCEEDED" : "FAILED",
      error_class: exitCode === 0 ? null : "backend_bug",
      finished_at: new Date().toISOString(),
      summary: exitCode === 0 ? "process completed" : `process failed with exit ${exitCode}`,
    });
    // Resource ownership is managed by the typed adapter; process control only updates Job evidence.
  }
  save(root, state);
  return { ...(mediaMeta || { ok: !failed }), tool: name, cwd, ...(file ? { path: file } : {}), ...(commandSummary ? { command_summary: commandSummary } : {}), ...(processId ? { process_id: processId, running: exitCode === null && name === "hanako_start_process" } : {}), ...(name === "hanako_process_status" && args.process_id ? { process_id: args.process_id, running: output.includes(String(args.process_id)) } : {}), ...(exitCode !== null ? { exit_code: exitCode } : {}), ...(!mediaMeta ? { output: String(output || "").slice(0, 100_000) } : {}), ...(richContent ? { __mcp_content: richContent } : {}), context: { current_task_id: state.current_task_id, current_cwd: state.current_cwd, active_process_ids: state.active_process_ids, last_validation_result: state.last_validation_result, last_execution_summary: state.last_execution_summary } };
}
