/**
 * Remote view of the runtime's task queue — read-only, no side effects.
 *
 * Why this file exists: until now the remote surface could say "the bridge is alive" (hanako_status),
 * "here is a file" (hanako_read) and "here are results" (hanako_pick_results), but not "what has
 * Hanako been asked to do, and where is it now". The only way to answer that from ChatGPT was to
 * read directories through hanako_read, which is exactly what a tool surface is supposed to replace.
 *
 * Authority: the queue belongs to the runtime (`oh_runtime.task_queue.TaskQueue`, root
 * `<workspace>/work/bridge/queue`). This module never writes a document, never acks, never moves
 * anything and never executes. It derives a status with the *same* rule the runtime's own
 * `TaskQueue.status_of` uses:
 *
 *     results/<task_id>.json ? result.status (default "done")
 *   : acks/<task_id>.json    ? ack.status    (default "accepted")
 *   :                          "submitted"
 *
 * A mirror is a real risk (two implementations drift), so it is not taken on faith: the surface
 * smoke (`check-b3.cjs`) cross-checks every task in the live queue against the Python authority and
 * fails on any disagreement. `runtime_status` in every answer is the runtime's own word, unmapped,
 * so a reader can always see the raw fact behind the projection.
 *
 * Deliberately not read here: `state/executions.jsonl` (the execution ledger). It grows without
 * bound, and a state that exists only in the ledger (`deferred`, `misdirected`) is therefore not
 * reported — a declared limit of Remote Surface v1 (see docs/REMOTE_CONTROL_SURFACE_V1.md), not a
 * claim that every task is in one of the states below. The one ledger-visible fact that *is*
 * reported is the `misdirected.txt` evidence file, because it is a document like any other.
 *
 * Error shape: a refusal is an in-band answer (`ok:false` + `error:{code,message}`), not a thrown
 * exception, because "you asked for something this surface will not do" is information the caller
 * must be able to branch on. Throwing is reserved for a real fault.
 */

import fs from "node:fs";
import path from "node:path";

import { DEFAULT_WORKSPACE } from "./bridge-core.mjs";

export const TOOL_LIST_TASKS = "hanako_list_tasks";
export const TOOL_TASK_STATUS = "hanako_task_status";

export const QUEUE_SUBPATH = path.join("work", "bridge", "queue");
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
export const TITLE_CHARS = 120;

/** Task ids become file names, so the shape is enforced before any path is built. */
export const TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

/**
 * The status vocabulary of Remote Surface v1. Frozen now; extending it later is additive.
 * `unknown` is the honest escape hatch: the runtime reported a state this surface version does not
 * recognise, and `runtime_status` carries the raw word.
 */
export const STATUS_VOCABULARY = ["queued", "running", "done", "failed", "refused", "unknown"];

/**
 * Named in the v1 vocabulary so the names never change, but not accepted as a filter today: the
 * runtime cannot produce them yet, and letting a caller filter on a state that can never exist would
 * imply a capability that is not there.
 */
export const RESERVED_STATUS = ["waiting_for_human", "retrying", "cancelled"];

export const ORDER = ["asc", "desc"];

export function queuePaths(root) {
  const workspace = path.resolve(root || DEFAULT_WORKSPACE);
  const bridge = path.join(workspace, "work", "bridge");
  const queue = path.join(bridge, "queue");
  return {
    workspace,
    bridge,
    queue,
    tasks: path.join(queue, "tasks"),
    acks: path.join(queue, "acks"),
    results: path.join(queue, "results"),
    evidence: path.join(queue, "evidence"),
  };
}

/* ------------------------------------------------------------------ *
 * reading documents (never writing them)
 * ------------------------------------------------------------------ */

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir).filter((name) => isFile(path.join(dir, name))).sort();
  } catch {
    return [];
  }
}

function newestMtimeMs(files) {
  let newest = 0;
  for (const file of files) {
    try {
      const stat = fs.statSync(file);
      if (stat.mtimeMs > newest) newest = stat.mtimeMs;
    } catch {
      // a document that is not there contributes no time
    }
  }
  return newest;
}

/** The runtime's own derivation, mirrored. `runtime_status` is that raw word. */
function rawStatus(paths, taskId) {
  const result = readJson(path.join(paths.results, `${taskId}.json`));
  if (result !== null) return String((result && result.status) || "done");
  const ack = readJson(path.join(paths.acks, `${taskId}.json`));
  if (ack === null) return "submitted";
  return String((ack && ack.status) || "accepted");
}

/**
 * The projection, written down as a table rather than spread through branches. Coarse status is what
 * a caller reasons about; `runtime_status` is never hidden behind it.
 *
 *   submitted -> queued    / submitted            (in the queue, not yet acknowledged)
 *   accepted  -> running   / acknowledged         (acknowledged, no result yet: the ACK is written
 *                                                  before execution, so this covers "about to run")
 *   rejected  -> refused   / refused_at_intake
 *   done      -> done      / completed
 *   failed    -> failed    / completed
 *   <other>   -> unknown   / unrecognised
 */
function project(raw) {
  if (raw === "submitted") return { status: "queued", stage: "submitted" };
  if (raw === "accepted") return { status: "running", stage: "acknowledged" };
  if (raw === "rejected") return { status: "refused", stage: "refused_at_intake" };
  if (raw === "done") return { status: "done", stage: "completed" };
  if (raw === "failed") return { status: "failed", stage: "completed" };
  return { status: "unknown", stage: "unrecognised" };
}

/** The protocol has no title field. The first line of the objective is the closest thing to a name,
 * and it is labelled as derived so nobody mistakes it for a stored value. */
function titleOf(envelope) {
  const objective = String((envelope && envelope.objective) || "").replace(/\s+/g, " ").trim();
  if (!objective) return "";
  const withoutLabel = objective.replace(/^Goal:\s*/i, "");
  return withoutLabel.length > TITLE_CHARS ? `${withoutLabel.slice(0, TITLE_CHARS - 1)}…` : withoutLabel;
}

/** Why a task is not moving, in one line, or "" when nothing is known to be wrong. */
function blockerOf(ack, result, evidenceNames) {
  if (ack && ack.status === "rejected") {
    const reason = String(ack.reason || "").trim();
    if (reason) return reason;
    const first = Array.isArray(ack.rejections) && ack.rejections[0];
    const message = first && (first.message || first.rule);
    return message ? String(message) : "refused at intake";
  }
  if (result && result.status && result.status !== "done") {
    return String(result.error || `executor reported ${result.status}`);
  }
  if (evidenceNames.includes("misdirected.txt")) {
    return "the task document changed after execution; the earlier result stands";
  }
  return "";
}

/** Everything the queue can honestly say about one task. Reads documents; writes nothing. */
function describeTask(paths, taskId, envelope) {
  const ackPath = path.join(paths.acks, `${taskId}.json`);
  const resultPath = path.join(paths.results, `${taskId}.json`);
  const ack = readJson(ackPath);
  const result = readJson(resultPath);
  const evidenceNames = listDir(path.join(paths.evidence, taskId));

  const raw = rawStatus(paths, taskId);
  const { status, stage } = project(raw);

  const requested = (envelope && envelope.requested) || {};
  const intent = (envelope && envelope.intent) || {};
  const files = [path.join(paths.tasks, `${taskId}.json`), ackPath, resultPath].concat(
    evidenceNames.map((name) => path.join(paths.evidence, taskId, name))
  );
  const newest = newestMtimeMs(files);

  return {
    task_id: taskId,
    title: titleOf(envelope),
    status,
    runtime_status: raw,
    current_stage: stage,
    intent_kind: intent.kind ? String(intent.kind) : null,
    risk: envelope && envelope.risk ? String(envelope.risk) : null,
    source: envelope && envelope.source ? String(envelope.source) : null,
    origin: requested.origin ? String(requested.origin) : null,
    request_id: requested.request_id === undefined ? null : requested.request_id,
    created_at: envelope && envelope.created_at ? String(envelope.created_at) : null,
    updated_at: newest ? new Date(newest).toISOString() : (envelope && envelope.created_at) || null,
    result_available: result !== null,
    run_index: result && result.run_index !== undefined ? result.run_index : null,
    blocker: blockerOf(ack, result, evidenceNames),
    // By construction on this door: local_rejections() refuses any request that asks for a gate, and
    // build_envelope() always sets requires_human_gate=false. Present so the field never has to be
    // added later, always null so it never implies the capability.
    pending_approval_id: null,
    ack_status: ack && ack.status ? String(ack.status) : null,
    executor: result && result.executor ? String(result.executor) : null,
    evidence: evidenceNames,
    documents: {
      envelope: `tasks/${taskId}.json`,
      ack: ack ? `acks/${taskId}.json` : null,
      result: result ? `results/${taskId}.json` : null,
      evidence: evidenceNames.length ? `evidence/${taskId}/` : null,
    },
  };
}

/* ------------------------------------------------------------------ *
 * arguments and refusals
 * ------------------------------------------------------------------ */

function ok(tool, requestId, result) {
  return { ok: true, tool, request_id: requestId === undefined ? null : requestId, result, error: null };
}

function refusal(tool, requestId, code, message) {
  return {
    ok: false,
    tool,
    request_id: requestId === undefined ? null : requestId,
    result: null,
    error: { code, message },
  };
}

function intArg(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

/** An unknown argument is a typo or a surprise, and both are better refused than ignored: this is the
 * same rule the drop tool applies, so the surface does not have two definitions of a valid call. */
function unknownKeys(args, allowed) {
  const unknown = Object.keys(args || {}).filter((key) => !allowed.includes(key));
  if (!unknown.length) return null;
  return `unexpected argument(s): ${unknown.join(", ")}; this tool accepts ${allowed.join(", ")}`;
}

/** A task id is a file name. Reject anything that is not exactly that shape, then check containment
 * as well: one rule that has been reviewed beats two that have to agree. */
function safeTaskId(paths, value) {
  const id = String(value === undefined || value === null ? "" : value).trim();
  if (!id) return { error: "task_id is required" };
  if (!TASK_ID_RE.test(id)) {
    return { error: "task_id must match [A-Za-z0-9][A-Za-z0-9._-]{0,79} (it is used as a file name)" };
  }
  const resolved = path.resolve(paths.tasks, `${id}.json`);
  const rel = path.relative(paths.tasks, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return { error: "task_id escapes the queue directory" };
  }
  return { id };
}

/* ------------------------------------------------------------------ *
 * the two tools
 * ------------------------------------------------------------------ */

/**
 * hanako_list_tasks — the queue as a list of briefs.
 *
 * Never returns a task body: `title` is a derived excerpt and the objective itself stays in the
 * document. Ordering defaults to the runtime's own scan order `(created_at, task_id)` ascending so
 * this view and `TaskQueue.scan()` cannot disagree about what "first" means.
 */
export function listTasks(root, args, requestId) {
  const paths = queuePaths(root);
  const input = args || {};

  const unknown = unknownKeys(input, ["status", "limit", "offset", "order"]);
  if (unknown) return refusal(TOOL_LIST_TASKS, requestId, "BAD_REQUEST", unknown);

  const status = input.status === undefined || input.status === null ? null : String(input.status);
  if (status !== null && !STATUS_VOCABULARY.includes(status)) {
    return refusal(
      TOOL_LIST_TASKS,
      requestId,
      "BAD_REQUEST",
      `status must be one of ${STATUS_VOCABULARY.join(", ")}${
        RESERVED_STATUS.includes(status)
          ? ` — '${status}' is reserved in the v1 vocabulary but not reachable yet, so it is not filterable`
          : ""
      }`
    );
  }

  const limit = intArg(input.limit, DEFAULT_LIMIT);
  if (limit === null || limit < 1 || limit > MAX_LIMIT) {
    return refusal(TOOL_LIST_TASKS, requestId, "BAD_REQUEST", `limit must be an integer 1..${MAX_LIMIT}`);
  }

  const offset = intArg(input.offset, 0);
  if (offset === null || offset < 0) {
    return refusal(TOOL_LIST_TASKS, requestId, "BAD_REQUEST", "offset must be an integer >= 0");
  }

  const order = input.order === undefined || input.order === null || input.order === "" ? "asc" : String(input.order);
  if (!ORDER.includes(order)) {
    return refusal(TOOL_LIST_TASKS, requestId, "BAD_REQUEST", `order must be one of ${ORDER.join(", ")}`);
  }

  const present = fs.existsSync(paths.tasks);
  const malformed = [];
  const rows = [];
  for (const name of listDir(paths.tasks)) {
    if (!name.endsWith(".json")) continue;
    const taskId = name.slice(0, -".json".length);
    const envelope = readJson(path.join(paths.tasks, name));
    if (envelope === null) {
      malformed.push({ file: name, reason: "unreadable or not a JSON object" });
      continue;
    }
    rows.push({ taskId, envelope });
  }
  rows.sort((a, b) => {
    const left = String(a.envelope.created_at || "");
    const right = String(b.envelope.created_at || "");
    if (left !== right) return left < right ? -1 : 1;
    return a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0;
  });

  const described = rows
    .map((row) => describeTask(paths, row.taskId, row.envelope))
    .filter((row) => status === null || row.status === status);
  if (order === "desc") described.reverse();

  const total = described.length;
  const page = described.slice(offset, offset + limit).map((row) => ({
    task_id: row.task_id,
    title: row.title,
    status: row.status,
    runtime_status: row.runtime_status,
    current_stage: row.current_stage,
    intent_kind: row.intent_kind,
    risk: row.risk,
    source: row.source,
    origin: row.origin,
    request_id: row.request_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    result_available: row.result_available,
  }));

  return ok(TOOL_LIST_TASKS, requestId, {
    queue: { path: paths.queue, present },
    filter: { status, order },
    count: page.length,
    total,
    offset,
    next_offset: offset + page.length < total ? offset + page.length : null,
    malformed,
    tasks: page,
  });
}

/** hanako_task_status — one task's present state, derived from its documents. */
export function taskStatus(root, args, requestId) {
  const paths = queuePaths(root);
  const input = args || {};
  const unknown = unknownKeys(input, ["task_id"]);
  if (unknown) return refusal(TOOL_TASK_STATUS, requestId, "BAD_REQUEST", unknown);
  const checked = safeTaskId(paths, input.task_id);
  if (checked.error) {
    return refusal(TOOL_TASK_STATUS, requestId, "BAD_REQUEST", checked.error);
  }

  const taskId = checked.id;
  const envelopePath = path.join(paths.tasks, `${taskId}.json`);
  if (!isFile(envelopePath)) {
    return refusal(
      TOOL_TASK_STATUS,
      requestId,
      "NOT_FOUND",
      `no task ${taskId} in this queue: a task exists here only after the runtime accepted the request`
    );
  }
  const envelope = readJson(envelopePath);
  if (envelope === null) {
    return refusal(TOOL_TASK_STATUS, requestId, "NOT_FOUND", `task ${taskId} is not a readable document`);
  }

  return ok(TOOL_TASK_STATUS, requestId, {
    queue: { path: paths.queue, present: fs.existsSync(paths.tasks) },
    task: describeTask(paths, taskId, envelope),
  });
}
