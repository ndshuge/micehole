import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isDeniedPath, resolveUnder, realpathInside } from "./bridge-core.mjs";

export const MICE_HOLE_VERSION = "0.2.0";
export const PROJECT_STATES = new Set(["ACTIVE", "DONE", "ARCHIVED"]);
const FILES = ["PROJECT.md", "STATUS.md", "TODO.md", "LOG.md"];
const LIMIT = 256 * 1024;
const WORK_STATES = new Set(['RUNNING', 'WAITING_PROCESS', 'WAITING_DOWNLOAD', 'WAITING_HUMAN', 'FAILED']);
const begin = kind => `<!-- mice-hole:${kind}:v1 -->`;
const end = kind => `<!-- /mice-hole:${kind}:v1 -->`;
const digest = text => createHash("sha256").update(text ?? "<absent>").digest("hex");
const fields = {
  project_status: "State", current_phase: "Phase", current_gate: "Gate", current_step: "Step",
  checkpoint: "Checkpoint", next_action: "Next", blocked_reason: "Blocker",
  last_validation: "Validation", work_state: "Work state", updated_at: "Updated",
};

export function createConstructionContext() {
  return { project_root: null, session_id: null, segment_number: 0, segment_started_at: null,
    lease_seconds: 1020, projects: new Map() };
}
function safeDirectory(root, requested, create = false) {
  const absolute = resolveUnder(root, requested);
  let ancestor = absolute;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const canonical = realpathInside(root, ancestor);
  if (isDeniedPath(canonical.rel) || isDeniedPath(path.relative(root, absolute).replaceAll("\\", "/"))) {
    throw new Error("Project path is protected");
  }
  if (!fs.existsSync(absolute)) {
    if (!create) throw new Error("Project directory does not exist; use start with an explicit project");
    fs.mkdirSync(absolute, { recursive: true });
  }
  const real = realpathInside(root, absolute);
  const compare = value => process.platform === 'win32' ? value.toLowerCase() : value;
  if (compare(path.resolve(absolute)) !== compare(path.resolve(real.realAbs))) throw new Error('Project directory is redirected; select its canonical project root explicitly');
  if (isDeniedPath(real.rel) || !fs.statSync(real.realAbs).isDirectory()) throw new Error("Invalid project directory");
  return real.realAbs;
}
function safeFile(directory, name) {
  const file = path.join(directory, name);
  let stat;
  try { stat = fs.lstatSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (stat) {
    // Reject links for memory/transaction files, including links to another project.
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Project memory file must be a regular file");
    const real = fs.realpathSync.native(file);
    if (path.dirname(real) !== directory) throw new Error("Project memory file leaves its project");
    if (name !== 'LOG.md' && fs.statSync(file).size > (name === '.mice-hole-transaction.json' ? LIMIT * 5 : LIMIT)) throw new Error("Project memory file exceeds its size limit");
  }
  return file;
}
function read(directory, name) {
  const file = safeFile(directory, name);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}
function documents(directory) {
  return Object.fromEntries(FILES.map(name => {
    if (name !== 'LOG.md') return [name, read(directory, name)];
    return [name, fs.existsSync(safeFile(directory, name)) ? '' : null];
  }));
}
function appendedBytes(directory, entry) {
  const file = safeFile(directory, entry.name), desired = Buffer.from(entry.text, 'utf8');
  const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
  if (!Number.isSafeInteger(entry.before_bytes) || entry.before_bytes < 0 || size < entry.before_bytes || size > entry.before_bytes + desired.length) throw new Error('Project recovery conflict in LOG.md');
  const count = size - entry.before_bytes;
  if (count) {
    const fd = fs.openSync(file, 'r'), actual = Buffer.alloc(count);
    try { fs.readSync(fd, actual, 0, count, entry.before_bytes); } finally { fs.closeSync(fd); }
    if (!actual.equals(desired.subarray(0, count))) throw new Error('Project recovery conflict in LOG.md');
  }
  return count;
}
function atomic(directory, name, text) {
  const file = safeFile(directory, name);
  const temporary = path.join(directory, `.mice-hole-${randomUUID()}.tmp`);
  const fd = fs.openSync(temporary, "wx");
  try { fs.writeFileSync(fd, text, "utf8"); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  try { fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function managed(text, kind) {
  if (!text?.includes(begin(kind))) return null;
  const start = text.indexOf(begin(kind)), finish = text.indexOf(end(kind), start);
  if (finish < 0 || text.indexOf(begin(kind), start + 1) >= 0) throw new Error("Malformed project memory section");
  return text.slice(start + begin(kind).length, finish).trim();
}
function replaceSection(text, kind, content, title) {
  const block = `${begin(kind)}\n${content}\n${end(kind)}`;
  if (managed(text, kind) === null) return `${text ?? `# ${title}\n`}${text?.endsWith("\n") ? "\n" : "\n\n"}${block}\n`;
  const start = text.indexOf(begin(kind)), finish = text.indexOf(end(kind), start) + end(kind).length;
  return text.slice(0, start) + block + text.slice(finish);
}
function parseFields(section, mapping) {
  const result = {};
  for (const [key, label] of Object.entries(mapping)) {
    const line = section.split(/\r?\n/).find(value => value.startsWith(label + ":"));
    if (!line) throw new Error(`Missing project field: ${label}`);
    const raw = line.slice(label.length + 1).trim();
    result[key] = /^(?:"|null\b)/.test(raw) ? JSON.parse(raw) : raw;
    if (result[key] !== null && typeof result[key] !== "string") throw new Error(`Invalid project field: ${label}`);
  }
  return result;
}
function recover(directory) {
  const journal = read(directory, ".mice-hole-transaction.json");
  if (!journal) return;
  const entries = JSON.parse(journal);
  if (!Array.isArray(entries) || entries.length > 4 || new Set(entries.map(entry => entry.name)).size !== entries.length) throw new Error("Invalid project transaction");
  // Validate the whole transaction before applying any part of a recovery.
  for (const entry of entries) {
    if (!FILES.includes(entry.name) || typeof entry.text !== "string" || Buffer.byteLength(entry.text) > LIMIT) throw new Error("Invalid project transaction entry");
    if (entry.append) {
      if (entry.name !== 'LOG.md') throw new Error('Invalid project append target');
      appendedBytes(directory, entry); continue;
    }
    const current = digest(read(directory, entry.name));
    if (current !== entry.before && current !== digest(entry.text)) throw new Error("Project recovery conflict; preserve files and inspect the transaction");
  }
  for (const entry of entries) {
    if (entry.append) {
      const count = appendedBytes(directory, entry), bytes = Buffer.from(entry.text, 'utf8');
      if (count < bytes.length) {
        const fd = fs.openSync(safeFile(directory, entry.name), 'a');
        try { fs.writeFileSync(fd, bytes.subarray(count)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      }
    } else if (read(directory, entry.name) !== entry.text) atomic(directory, entry.name, entry.text);
  }
  fs.unlinkSync(safeFile(directory, ".mice-hole-transaction.json"));
}
function withLock(directory, action) {
  const file = safeFile(directory, ".mice-hole.lock");
  let fd;
  try { fd = fs.openSync(file, "wx"); }
  catch (cause) {
    if (cause.code !== "EEXIST") throw cause;
    const owner = JSON.parse(fs.readFileSync(file, "utf8"));
    try { process.kill(owner.pid, 0); }
    catch (error) {
      if (error.code !== "ESRCH") throw new Error("Project memory is busy");
      fs.unlinkSync(file);
      return withLock(directory, action);
    }
    throw new Error("Project memory is busy");
  }
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid }), "utf8");
  try { recover(directory); return action(); }
  finally { fs.closeSync(fd); fs.unlinkSync(file); }
}
export function readProjectMemory(directory) {
  return withLock(directory, () => {
    const files = documents(directory);
    const status = managed(files["STATUS.md"], "status");
    if (status === null) return null;
    const state = parseFields(status, fields);
    if (!PROJECT_STATES.has(state.project_status)) throw new Error("Invalid project state; expected ACTIVE, DONE or ARCHIVED");
    if (!WORK_STATES.has(state.work_state)) throw new Error('Invalid project work state');
    const identity = managed(files["PROJECT.md"], "project");
    if (identity === null || FILES.some(name => files[name] === null)) throw new Error("Project memory is incomplete; preserve files and use start to initialize");
    return { ...state, ...parseFields(identity, { name: "Name", goal: "Goal", end_condition: "End condition", plan_file: "Plan" }),
      project_root: directory, files: FILES.map(name => path.join(directory, name)),
      todo: files["TODO.md"].slice(0, 12000) };
  });
}
export function writeProjectMemory(directory, patch, operation) {
  return withLock(directory, () => {
    const files = documents(directory);
    const section = managed(files["STATUS.md"], "status");
    const identity = managed(files["PROJECT.md"], "project");
    const previous = section === null ? {} : parseFields(section, fields);
    const oldIdentity = identity === null ? {} : parseFields(identity, { name: "Name", goal: "Goal", end_condition: "End condition", plan_file: "Plan" });
    // Guard obvious credential material in *managed fields*. This is a narrow
    // safety net, not general DLP for direct file/command operations.
    const secretPattern = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-proj-|sk-[A-Za-z0-9]{28}|gh[pousr]_[A-Za-z0-9]{30}|AKIA[0-9A-Z]{16})/;
    if (Object.values(patch).some(value => typeof value === 'string' && secretPattern.test(value))) {
      throw new Error('Project memory managed fields cannot contain credential material');
    }
    const next = { project_status: "ACTIVE", work_state: "RUNNING", current_phase: null, current_gate: null, current_step: null,
      checkpoint: null, next_action: null, blocked_reason: null, last_validation: null, name: path.basename(directory),
      goal: null, end_condition: null, plan_file: null, ...oldIdentity, ...previous, ...patch, updated_at: new Date().toISOString() };
    if (!PROJECT_STATES.has(next.project_status)) throw new Error("Invalid project state");
    if (!WORK_STATES.has(next.work_state)) throw new Error('Invalid project work state');
    for (const key of [...Object.keys(fields), "name", "goal", "end_condition", "plan_file"]) {
      if (next[key] !== null && typeof next[key] !== "string") throw new Error(`Invalid project field: ${key}`);
      if (typeof next[key] === "string" && next[key].length > 4000) throw new Error(`Project field too long: ${key}`);
    }
    // Do not touch STATUS/TODO/LOG or their timestamps when durable facts did not change.
    // Read under the existing writer lock, so this is safe across short sessions.
    const persisted = { ...oldIdentity, ...previous };
    const durableKeys = [...Object.keys(fields).filter(key => key !== "updated_at"), "name", "goal", "end_condition", "plan_file"];
    if (section !== null && identity !== null && files["TODO.md"] !== null && files["LOG.md"] !== null &&
        durableKeys.every(key => next[key] === persisted[key])) return { ...next, updated_at: previous.updated_at, unchanged: true };
    const status = Object.entries(fields).map(([key, label]) => `${label}: ${key === "project_status" || key === "work_state" ? next[key] : JSON.stringify(next[key])}`).join("\n");
    const project = Object.entries({ name: "Name", goal: "Goal", end_condition: "End condition", plan_file: "Plan" }).map(([key, label]) => `${label}: ${JSON.stringify(next[key])}`).join("\n");
    const nextDocuments = {
      "PROJECT.md": replaceSection(files["PROJECT.md"], "project", project, "Project"),
      "TODO.md": replaceSection(files["TODO.md"], "todo", next.next_action ? `- [ ] ${JSON.stringify(next.next_action)}` : "No next action recorded; review this project's existing tasks before choosing new work.", "Tasks"),
      "LOG.md": `${files["LOG.md"] === null ? "# Project log\n" : ''}\n- ${next.updated_at} | ${operation} | ${JSON.stringify({ state: next.project_status, phase: next.current_phase, checkpoint: next.checkpoint, next: next.next_action })}\n`,
      "STATUS.md": replaceSection(files["STATUS.md"], "status", status, "Project status"),
    };
    const entries = Object.entries(nextDocuments).map(([name, text]) => name === 'LOG.md'
      ? { name, text, append: true, before_bytes: files[name] === null ? 0 : fs.statSync(safeFile(directory, name)).size }
      : { name, text, before: digest(files[name]) });
    if (entries.some(entry => Buffer.byteLength(entry.text) > LIMIT)) throw new Error("Project memory file exceeds 256 KiB");
    atomic(directory, ".mice-hole-transaction.json", JSON.stringify(entries));
    recover(directory);
    return next;
  });
}
function explicitProject(root, value, create) {
  const aliases = { "AI学院": "ai-academy", FactGuard: "factguard", RoleVault: "rolevault", "Mice Hole": "openhanako-runtime" };
  const requested = aliases[value] ?? value;
  const candidate = path.isAbsolute(requested) || /[\\/]/.test(requested) ? requested
    : fs.existsSync(path.join(root, requested)) ? path.join(root, requested) : path.join(root, "projects", requested);
  return safeDirectory(root, candidate, create);
}
function nearestProject(root, cwd) {
  let directory = safeDirectory(root, cwd);
  while (true) {
    if (fs.existsSync(path.join(directory, "PROJECT.md")) && fs.existsSync(path.join(directory, "STATUS.md"))) return directory;
    if (path.relative(root, directory) === "") return null;
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}
export function discoverProjects(root) {
  const base = path.join(root, "projects");
  if (!fs.existsSync(base)) return [];
  safeDirectory(root, base);
  const result = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true }).filter(item => item.isDirectory()).slice(0, 500)) {
    const directory = safeDirectory(root, path.join(base, entry.name));
    if (!fs.existsSync(path.join(directory, "STATUS.md")) || !fs.existsSync(path.join(directory, "PROJECT.md"))) continue;
    const memory = readProjectMemory(directory);
    if (memory) result.push({ name: memory.name, project_root: directory, project_status: memory.project_status, current_phase: memory.current_phase });
  }
  return result;
}
export function resolveProject(root, args, context, create = false) {
  root = fs.realpathSync.native(root);
  if (args.project_root || args.project) return explicitProject(root, String(args.project_root || args.project), create);
  if (args.cwd) return nearestProject(root, args.cwd) ?? safeDirectory(root, args.cwd, create);
  if (context.project_root) return safeDirectory(root, context.project_root);
  if (process.env.MOUSE_HOLE_PROJECT) return explicitProject(root, process.env.MOUSE_HOLE_PROJECT, false);
  // Ambient cwd is only a hint inside this workspace, never a permission expansion.
  try { const nearby = nearestProject(root, process.cwd()); if (nearby) return nearby; } catch {}
  const candidates = discoverProjects(root);
  const active = candidates.filter(item => item.project_status === "ACTIVE");
  if (active.length === 1) return active[0].project_root;
  if (create && !fs.existsSync(path.join(root, "projects"))) return root; // isolated/flat project root
  return null;
}
