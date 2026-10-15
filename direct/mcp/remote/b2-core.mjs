/**
 * B2 drop core — the remote entry turns one request into one task document.
 *
 * Why this file is separate from `bridge-core.mjs`: `bridge-core.mjs` is the frozen B1 surface core
 * (status / read / pick), and B1 stays exactly as verified. B2 adds one write path, and a rollback
 * anchor is only worth anything if the thing being rolled back to is untouched.
 *
 * What a remote drop is allowed to be:
 *
 *   request  →  validate (fail closed)  →  one document in the inbox  →  stop
 *
 * It does not execute anything, does not run a shell, git, a model or a subprocess, and does not
 * touch the runtime. It writes exactly one file, inside `work/bridge/inbox`, and it writes that file
 * atomically (temp + rename) so a reader never sees a half-written request. The document it writes is
 * a *request*, deliberately not a task envelope: the side that owns the mapping (the runtime's
 * intake, `scripts/b2_inbox_consumer.py`) builds the envelope and admits it. A remote caller must not
 * be able to hand the runtime a pre-shaped task document.
 *
 * The two rules that make the remote door safe, and neither of them is in the protocol:
 *
 *   1. **No gate, ever.** The runtime's protocol checks that a Human Gate *carries* an approval
 *      reference; it cannot check whether the reference is real. So a remote caller could declare
 *      `requires_human_gate: true` with a made-up reference and pass. That is the one hole that would
 *      matter here, and the door closes it by refusing the whole idea: risk is `low`, the gate flag
 *      is set *here* (closed), and a request that asks for anything else is refused with a reason
 *      rather than silently downgraded.
 *   2. **The workspace is not a parameter.** `E:\CHATGPT` is the only root, whether or not the caller
 *      sends one; a different value is refused rather than ignored, because silently ignoring it
 *      would let a caller believe a task landed somewhere it did not.
 *
 * Idempotency is structural rather than bookkept: `task_id` is `rcm-<request_id>`, so the same
 * request_id always names the same file. A second drop with identical content is reported as a
 * duplicate (and returns the same id); a second drop with *different* content under the same id is
 * refused, because overwriting a task that is already queued is how a submitted task quietly becomes
 * a different task. The runtime re-checks all of this on its own side; this is the door, not the
 * authority.
 */

import fs from "node:fs";
import path from "node:path";

import { bridgePaths } from "./bridge-core.mjs";

export const REQUEST_SCHEMA = "hanako-remote-task-request/1";
export const ORIGIN = "chatgpt-remote-mcp";
export const TASK_ID_PREFIX = "rcm-";

/** Stable refusal codes. A caller should be able to branch on these without parsing prose. */
export const REFUSAL = {
  BAD_FIELDS: "DROP_BAD_FIELDS",
  BAD_REQUEST_ID: "DROP_BAD_REQUEST_ID",
  BAD_GOAL: "DROP_BAD_GOAL",
  BAD_ACCEPTANCE: "DROP_BAD_ACCEPTANCE",
  BAD_TEXT_FIELD: "DROP_BAD_TEXT_FIELD",
  BAD_LIST_FIELD: "DROP_BAD_LIST_FIELD",
  BAD_INTENT: "DROP_BAD_INTENT",
  BAD_WORKSPACE: "DROP_BAD_WORKSPACE",
  GATE_NOT_ALLOWED: "DROP_GATE_NOT_ALLOWED",
  CONFLICTING_DUPLICATE: "DROP_CONFLICTING_DUPLICATE",
};

/** The one intent a remote caller may name. Both executors are write-free; only `echo` is path-free. */
export const REMOTE_INTENTS = ["echo"];

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,55}$/;
const ALLOWED_KEYS = new Set([
  "request_id",
  "goal",
  "acceptance",
  "context",
  "constraints",
  "non_goals",
  "intent_kind",
  "intent_args",
  "risk",
  "workspace",
  "model",
  "thinking",
]);
/** Named separately so a refusal can say *why* rather than "unknown field". */
const GATE_KEYS = new Set(["authority", "approval_ref", "requires_human_gate", "human_gate"]);

const LIMIT = { goal: 4000, context: 8000, list: 20, item: 500, serialized: 8000 };
const ECHO_MAX_SCOPE = ["no filesystem access: a deterministic function of the envelope"];

export class DropRefusal extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

const refuse = (code, message) => {
  throw new DropRefusal(code, message);
};

/**
 * `rcm-<request_id>`, so the runtime's task id carries its idempotency key verbatim. The pattern
 * above keeps this inside the protocol's `[A-Za-z0-9][A-Za-z0-9._-]{0,63}` bound (55 + 4 = 59).
 */
export function taskIdFor(requestId) {
  return `${TASK_ID_PREFIX}${requestId}`;
}

function requireString(value, field, code, max) {
  if (typeof value !== "string" || !value.trim()) {
    refuse(code, `${field} must be a non-empty string`);
  }
  if (value.length > max) refuse(code, `${field} is longer than ${max} characters`);
  return value;
}

function checkWorkspace(value, root) {
  if (value === undefined || value === null || value === "") return;
  if (typeof value !== "string") refuse(REFUSAL.BAD_WORKSPACE, "workspace must be a string");
  const normalize = (p) => path.resolve(String(p)).replace(/[\\/]+$/, "").toLowerCase();
  if (normalize(value) !== normalize(root)) {
    refuse(
      REFUSAL.BAD_WORKSPACE,
      `this bridge serves one workspace (${root}); it will not ignore a different one`
    );
  }
}

function checkList(value, field) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) refuse(REFUSAL.BAD_LIST_FIELD, `${field} must be an array of strings`);
  if (value.length > LIMIT.list) refuse(REFUSAL.BAD_LIST_FIELD, `${field} may hold at most ${LIMIT.list} items`);
  return value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      refuse(REFUSAL.BAD_LIST_FIELD, `${field}[${index}] must be a non-empty string`);
    }
    if (item.length > LIMIT.item) {
      refuse(REFUSAL.BAD_LIST_FIELD, `${field}[${index}] is longer than ${LIMIT.item} characters`);
    }
    return item;
  });
}

/**
 * Validate one drop and return the request document to write. Pure: no I/O, no clock.
 *
 * Fail-closed and complete: every problem is reported, not just the first, so a caller can fix one
 * turn instead of one field per round trip. Nothing is ever coerced into something valid.
 */
export function buildRequest(args, identity, root) {
  args = args || {};
  const unknown = Object.keys(args).filter((key) => !ALLOWED_KEYS.has(key));
  if (unknown.length) {
    const gate = unknown.filter((key) => GATE_KEYS.has(key));
    if (gate.length) {
      refuse(
        REFUSAL.GATE_NOT_ALLOWED,
        `a remote caller cannot declare or approve a Human Gate (${gate.join(", ")}). ` +
          "Gate-requiring work must be submitted locally, where a human can issue the approval."
      );
    }
    refuse(REFUSAL.BAD_FIELDS, `unknown field(s): ${unknown.join(", ")}`);
  }

  const requestId = String(args.request_id ?? "");
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    refuse(
      REFUSAL.BAD_REQUEST_ID,
      "request_id must match [A-Za-z0-9][A-Za-z0-9._-]{2,55}; it is the idempotency key, and a " +
        "repeated request_id must name the same task"
    );
  }
  requireString(args.goal, "goal", REFUSAL.BAD_GOAL, LIMIT.goal);

  const acceptance = args.acceptance;
  if (acceptance === undefined || acceptance === null || acceptance === "") {
    refuse(REFUSAL.BAD_ACCEPTANCE, "acceptance is required: a task without a stated exit is not a contract");
  }
  if (typeof acceptance !== "string" && (typeof acceptance !== "object" || Array.isArray(acceptance))) {
    refuse(REFUSAL.BAD_ACCEPTANCE, "acceptance must be a string or an object");
  }
  if (JSON.stringify(acceptance).length > LIMIT.serialized) {
    refuse(REFUSAL.BAD_ACCEPTANCE, `acceptance is longer than ${LIMIT.serialized} serialized characters`);
  }

  let context;
  if (args.context !== undefined && args.context !== null && args.context !== "") {
    context = requireString(args.context, "context", REFUSAL.BAD_TEXT_FIELD, LIMIT.context);
  }

  const intentKind = args.intent_kind === undefined ? "echo" : String(args.intent_kind);
  if (!REMOTE_INTENTS.includes(intentKind)) {
    refuse(
      REFUSAL.BAD_INTENT,
      `the remote door admits only intent kind ${JSON.stringify(REMOTE_INTENTS)}, got "${intentKind}"`
    );
  }
  const intentArgs = args.intent_args === undefined || args.intent_args === null ? {} : args.intent_args;
  if (typeof intentArgs !== "object" || Array.isArray(intentArgs)) {
    refuse(REFUSAL.BAD_INTENT, "intent_args must be an object");
  }
  if (JSON.stringify(intentArgs).length > LIMIT.serialized) {
    refuse(REFUSAL.BAD_INTENT, `intent_args is longer than ${LIMIT.serialized} serialized characters`);
  }
  if (Object.keys(intentArgs).length) {
    refuse(
      REFUSAL.BAD_INTENT,
      `intent "${intentKind}" takes no arguments; refusing ${JSON.stringify(Object.keys(intentArgs))} ` +
        "rather than dropping them silently"
    );
  }

  const risk = args.risk === undefined ? "low" : String(args.risk);
  if (risk !== "low") {
    refuse(
      REFUSAL.GATE_NOT_ALLOWED,
      `the remote door admits only risk "low", got "${risk}". Anything above it must be submitted ` +
        "locally, where a human can issue an approval reference this bridge cannot verify."
    );
  }

  checkWorkspace(args.workspace, root);

  const contract = {
    goal: String(args.goal),
    risk: "low",
    acceptance,
    ...(context ? { context } : {}),
  };
  const constraints = checkList(args.constraints, "constraints");
  if (constraints) contract.constraints = constraints;
  const nonGoals = checkList(args.non_goals, "non_goals");
  if (nonGoals) contract.non_goals = nonGoals;

  return {
    schema: REQUEST_SCHEMA,
    request_id: requestId,
    task_id: taskIdFor(requestId),
    received_at: new Date().toISOString(),
    origin: ORIGIN,
    source: "chat",
    subject: identity && identity.subject ? identity.subject : null,
    session: identity && identity.session ? identity.session : null,
    workspace: path.resolve(root),
    contract,
    intent: { kind: intentKind, args: {} },
    requested: {
      ...(args.model ? { model: String(args.model).slice(0, 100) } : {}),
      ...(args.thinking ? { thinking: String(args.thinking).slice(0, 100) } : {}),
    },
    remote_intent_scope: ECHO_MAX_SCOPE,
  };
}

/**
 * The semantic identity of a request, ignoring when it was received. Same rule as the runtime's
 * `task_fingerprint`: arriving twice is not a different task, arriving *different* is.
 */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    );
  }
  return value;
}

function fingerprint(request) {
  const { received_at: _ignored, ...rest } = request;
  return JSON.stringify(canonical(rest));
}

/**
 * Write the request into the inbox, atomically, and report whether it was already there.
 * Returns `{ taskId, file, created }`; throws `DROP_CONFLICTING_DUPLICATE` when the same id would
 * describe a different task.
 */
export function writeRequest(root, request) {
  const paths = bridgePaths(root);
  fs.mkdirSync(paths.inbox, { recursive: true });
  const target = path.join(paths.inbox, `${request.task_id}.json`);

  let existingRaw = null;
  try {
    existingRaw = fs.readFileSync(target, "utf8");
  } catch {
    existingRaw = null;
  }
  if (existingRaw !== null) {
    let existing = null;
    try {
      existing = JSON.parse(existingRaw);
    } catch {
      existing = null;
    }
    if (existing && fingerprint(existing) === fingerprint(request)) {
      return { taskId: request.task_id, file: path.basename(target), created: false };
    }
    refuse(
      REFUSAL.CONFLICTING_DUPLICATE,
      `request_id ${request.request_id} already names a different task; a conflicting duplicate is ` +
        "refused, not overwritten. Use a new request_id for a new task."
    );
  }

  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(request, null, 2), "utf8");
  fs.renameSync(temporary, target);
  return { taskId: request.task_id, file: path.basename(target), created: true };
}
