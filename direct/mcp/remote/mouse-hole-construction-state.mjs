/** Compatibility facade: project files own durable facts; connections own transient execution. */
import fs from "node:fs";
import path from "node:path";
import { createConstructionContext, discoverProjects, readProjectMemory, resolveProject, writeProjectMemory } from "./mouse-hole-project-memory.mjs";
export { createConstructionContext } from "./mouse-hole-project-memory.mjs";
export const CONSTRUCTION_STATES = new Set(["IDLE", "RUNNING", "WAITING_PROCESS", "WAITING_DOWNLOAD", "WAITING_HUMAN", "FAILED", "DONE", "ARCHIVED"]);
// Small, bounded instruction entry, not a duplicate memory store or full AGENTS load.
export function projectRuleEntry(root, directory) {
  const choose = (location) => fs.existsSync(location) && fs.statSync(location).isFile() ? location : null;
  return {
    entry_version: 1,
    global_rules: choose(path.join(root, 'AGENTS.md')),
    project_rules: choose(path.join(directory, 'AGENTS.md')),
    md_policy: choose(path.join(root, '_system', 'MD_SESSION_POLICY.md')),
    asset_index: choose(path.join(root, '_system', 'ASSET_INDEX.md')),
    current_state: path.join(directory, 'STATUS.md'),
    guidance: 'At project entry read applicable AGENTS instructions once; resume from current STATUS, verify live files/tests, then act. Read topic docs and asset index only when relevant. Write a milestone checkpoint only when durable facts change; never treat MD as test evidence.'
  };
}
const contexts = new Map();
function connection(root, supplied) {
  if (supplied) return supplied;
  const key = path.resolve(root);
  if (!contexts.has(key)) contexts.set(key, createConstructionContext());
  return contexts.get(key);
}
// Legacy path is read-only evidence. vNext never writes this global file.
export function constructionStatePath(root) { return path.join(root, "work", "mouse-hole", "construction-state.json"); }
export function defaultConstructionState() {
  return { session_id: null, project: null, project_root: null, project_status: null, state: "IDLE",
    goal: null, end_condition: null, current_phase: null, current_gate: null, current_step: null,
    checkpoint: null, blocked_reason: null, next_action: null, active_processes: [],
    segment_number: 0, segment_started_at: null, lease_seconds: 1020 };
}
function view(memory, context) {
  const execution = context.projects.get(memory.project_root) ?? { active_processes: [] };
  return { ...defaultConstructionState(), ...memory, ...execution, project: memory.name, cwd: memory.project_root,
    state: memory.project_status === "ACTIVE" ? memory.work_state : memory.project_status,
    session_id: context.session_id, segment_number: context.segment_number,
    segment_started_at: context.segment_started_at, lease_seconds: context.lease_seconds };
}
export function loadConstructionState(root, supplied, selection = {}) {
  const context = connection(root, supplied);
  const directory = resolveProject(root, selection, context);
  if (!directory) return { ...defaultConstructionState(), needs_project: true, projects: discoverProjects(root), legacy_available: fs.existsSync(constructionStatePath(root)) };
  const memory = readProjectMemory(directory);
  if (!memory) return { ...defaultConstructionState(), project_root: directory, needs_initialization: true };
  context.project_root = directory;
  return view(memory, context);
}
export function isConstructionTrackingActive(state) {
  return state?.project_status ? state.project_status === "ACTIVE" && state.state !== "FAILED"
    : Boolean(state?.session_id) && !["DONE", "FAILED", "ARCHIVED", "IDLE"].includes(state?.state);
}
export function describeConstructionState(state, nowMs = Date.now()) {
  const started = Date.parse(state?.segment_started_at);
  const age = Number.isFinite(started) ? Math.max(0, Math.floor((nowMs - started) / 1000)) : null;
  const active = isConstructionTrackingActive(state);
  return { ...state, segment_age_seconds: age,
    lease_remaining_seconds: active && age !== null ? Math.max(0, state.lease_seconds - age) : null,
    continuation_due: Boolean(active && age !== null && age >= state.lease_seconds) };
}
function projectPatch(patch) {
  const next = {};
  for (const key of ["name", "goal", "end_condition", "plan_file", "project_status", "current_phase", "current_gate", "current_step", "checkpoint", "next_action", "blocked_reason", "last_validation"]) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }
  if (patch.state !== undefined) {
    if (!CONSTRUCTION_STATES.has(patch.state) || patch.state === "IDLE") throw new Error("Invalid construction state");
    if (["DONE", "ARCHIVED"].includes(patch.state)) next.project_status = patch.state;
    else next.work_state = patch.state;
  }
  return next;
}
export function patchConstructionState(root, patch, supplied) {
  const context = connection(root, supplied);
  const current = loadConstructionState(root, context);
  if (!current.project_root || current.needs_initialization) throw new Error("No initialized project selected");
  const next = writeProjectMemory(current.project_root, projectPatch(patch), "execution.checkpoint");
  const transient = context.projects.get(current.project_root) ?? { active_processes: [] };
  for (const key of ["active_processes", "last_action", "last_result"]) if (patch[key] !== undefined) transient[key] = patch[key];
  context.projects.set(current.project_root, transient);
  for (const key of ["segment_started_at", "segment_number", "lease_seconds"]) if (patch[key] !== undefined) context[key] = patch[key];
  return view({ ...current, ...next }, context);
}
export function saveConstructionState(root, state, context) { return patchConstructionState(root, state, context); }
function segment(context, args) {
  const lease = args.lease_seconds ?? context.lease_seconds;
  if (!Number.isInteger(lease) || lease < 300 || lease > 1800) throw new Error("lease_seconds must be an integer from 300 to 1800");
  context.lease_seconds = lease;
  context.session_id = args.session_id ?? context.session_id;
  context.segment_number++;
  context.segment_started_at = new Date().toISOString();
}
export function constructionCall(root, args = {}, supplied) {
  const context = connection(root, supplied);
  const operation = args.operation;
  if (!["status", "start", "checkpoint", "resume", "continue", "finish"].includes(operation)) throw new Error("Unsupported construction operation");
  if (args.lease_seconds !== undefined && (!Number.isInteger(args.lease_seconds) || args.lease_seconds < 300 || args.lease_seconds > 1800)) throw new Error("Invalid lease_seconds");
  if (args.project_status !== undefined) throw new Error('Use finish/resume to change the project state');
  if (operation === "start" && args.goal !== undefined && !args.goal) throw new Error("goal is required");
  const directory = resolveProject(root, args, context, operation === "start" && Boolean(args.goal));
  if (!directory) return { ok: operation === "status", operation: `construction.${operation}`, failure: "project_selection_required",
    reason: "Select a project explicitly; multiple projects are never resolved by the latest global session.", construction: loadConstructionState(root, context) };
  let memory = readProjectMemory(directory);
  if (operation === 'start' && args.import_legacy === true && !memory) {
    const legacy = JSON.parse(fs.readFileSync(constructionStatePath(root), 'utf8'));
    if (!legacy.cwd || resolveProject(root, {cwd: legacy.cwd}, createConstructionContext()) !== directory) throw new Error('Legacy record belongs to a different project');
    args = { ...projectPatch(legacy), ...args };
    delete args.project_status;
    delete args.state;
  }
  if (!memory && operation !== "start") return { ok: false, operation: `construction.${operation}`, failure: "project_memory_not_initialized", project_root: directory,
    reason: "Use construction://start with this project to establish PROJECT.md, STATUS.md, TODO.md and LOG.md." };
  if (operation === "start") {
    if (!memory && !args.goal) throw new Error("goal is required to initialize a project");
    if (memory?.work_state === "WAITING_HUMAN") throw new Error("construction is waiting for a human gate");
    const idempotent = memory?.project_status === "ACTIVE";
    if (!idempotent) writeProjectMemory(directory, { ...projectPatch(args), name: args.name ?? memory?.name ?? path.basename(directory), project_status: "ACTIVE", work_state: "RUNNING" }, "start");
    context.project_root = directory;
    if (!idempotent || !context.segment_started_at) segment(context, args);
    return { ok: true, operation: "construction.start", idempotent: Boolean(idempotent), construction: describeConstructionState(view(readProjectMemory(directory), context)) };
  }
  context.project_root = directory;
  if (operation === "status") return { ok: true, operation: "construction.status", construction: describeConstructionState(view(memory, context)) };
  if (operation === "resume" || operation === "continue") {
    if (memory.work_state === "WAITING_HUMAN") throw new Error("construction is waiting for a human gate");
    if (memory.project_status === "ARCHIVED" && operation === "continue") return { ok: false, operation: "construction.continue", failure: "project_archived", reason: "Use explicit resume to reactivate the archived project." };
    const previousState = memory.project_status;
    const patch = { project_status: "ACTIVE", work_state: "RUNNING", ...projectPatch(args) };
    if (!args.next_action && !memory.next_action) patch.next_action = "Review TODO.md and record the next authorized action";
    writeProjectMemory(directory, patch, operation);
    segment(context, args);
    memory = readProjectMemory(directory);
    return { ok: true, operation: `construction.${operation}`, resumed_from: previousState,
      construction: describeConstructionState(view(memory, context)),
      continuation: { project_root: directory, phase: memory.current_phase, checkpoint: memory.checkpoint, next_action: memory.next_action,
        rule_entry: projectRuleEntry(root, directory),
        instruction: "Read the linked applicable rules if not already loaded; inspect actual evidence, carry out authorized next work, and only checkpoint when durable facts change. No background agent is scheduled." } };
  }
  if (operation === "checkpoint") {
    if (memory.project_status !== "ACTIVE") throw new Error("Resume the project before checkpointing");
    if (args.state !== undefined && !["RUNNING", "WAITING_PROCESS", "WAITING_DOWNLOAD", "WAITING_HUMAN"].includes(args.state)) throw new Error("checkpoint state must be a non-terminal construction state");
    writeProjectMemory(directory, projectPatch(args), operation);
  } else {
    if (!["DONE", "FAILED", "ARCHIVED"].includes(args.outcome)) throw new Error("outcome must be DONE, FAILED or ARCHIVED");
    if (context.projects.get(directory)?.active_processes?.length) throw new Error("active processes must be settled before construction finish");
    writeProjectMemory(directory, { ...projectPatch(args), project_status: args.outcome === "FAILED" ? "ACTIVE" : args.outcome,
      work_state: args.outcome === "FAILED" ? "FAILED" : "RUNNING", next_action: args.next_action ?? null }, operation);
  }
  return { ok: true, operation: `construction.${operation}`, construction: describeConstructionState(view(readProjectMemory(directory), context)) };
}

