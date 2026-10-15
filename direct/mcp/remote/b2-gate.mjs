/**
 * b2-gate - the Remote Gate door, carried by the existing write tool.
 *
 * The surface stays at seven tools. `hanako_engineering_submit` already takes a free
 * `request` object and says it screens nothing; this file is what keeps that promise while
 * adding exactly one capability behind it. A request whose `kind` is APPROVE_GATE or
 * REJECT_GATE is a Gate command, and it is handed to `b2_gate_adapter.py`, which routes it
 * through the existing ControlBridge request path to project-lab's Human Gate authority.
 * Every other request is untouched and still goes to the P3 chain.
 *
 * What this file does NOT do, on purpose:
 *
 *   - it adds no MCP tool and changes no tool schema (the 7-tool list and every schema are
 *     byte-for-byte what they were; only which door inside one tool a request reaches changed);
 *   - it never touches SQLite, never settles a gate, never writes a receipt - the gate row is
 *     project-lab's alone;
 *   - it keeps no second gate store, no queue and no attempt record;
 *   - it does not re-implement the authority rules. task_id and gate_id being required is a
 *     field contract, not a policy: the owner rule, the gate-ownership rule and the
 *     "never create a gate" rule all stay in d2_control.gate().
 *
 * `ok:false` is carried in band with an `error.code`, matching the engineering door's shape so
 * a client reads one refusal format on this tool, not two.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const TOOL_ENGINEERING_SUBMIT = "hanako_engineering_submit";
export const GATE_KINDS = ["APPROVE_GATE", "REJECT_GATE"];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ADAPTER = path.join(HERE, "b2_gate_adapter.py");
const DEFAULT_PYTHON = "E:\\CHATGPT\\projects\\project-lab\\.venv\\Scripts\\python.exe";
const ADAPTER_TIMEOUT_MS = 60_000;
const STDERR_TAIL = 1500;

/** Same rule as the engineering door: the id ends up in a file name. */
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function refused(code, message, extra) {
  return {
    ok: false,
    tool: TOOL_ENGINEERING_SUBMIT,
    error: { code, message },
    ...(extra || {}),
  };
}

function tail(text) {
  const s = String(text || "");
  return s.length <= STDERR_TAIL ? s : `…${s.slice(-STDERR_TAIL)}`;
}

/** The gate kind this request carries, or null when it is not a Gate request at all. */
export function gateKindOf(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) return null;
  const raw = String(request.kind || request.command_type || "").trim().toUpperCase();
  return GATE_KINDS.includes(raw) ? raw : null;
}

export function isGateRequest(request) {
  return gateKindOf(request) !== null;
}

/**
 * Route one Gate request. Synchronous, because the answer here is a routing outcome and not a
 * settled gate: the gate stays PENDING until project-lab's drain writes a receipt.
 */
export function submitGate(args = {}) {
  const request = args.request;
  const kind = gateKindOf(request);
  if (!kind) {
    return refused(
      "NOT_A_GATE_REQUEST",
      `kind must be one of ${GATE_KINDS.join(", ")} for this door; got ` +
        `${JSON.stringify(request && (request.kind || request.command_type))}.`
    );
  }

  const taskId = String(request.task_id || "").trim();
  if (!taskId) {
    return refused("MISSING_TASK_ID", "task_id is required: a Human Gate belongs to one task.");
  }

  const gateId = String(request.gate_id || "").trim();
  if (!gateId) {
    return refused(
      "MISSING_GATE_ID",
      "gate_id is required: a remote caller may not approve 'whatever is pending' on a task."
    );
  }

  const rawId = request.request_id == null ? "" : String(request.request_id).trim();
  if (rawId && !REQUEST_ID.test(rawId)) {
    return refused(
      "REQUEST_ID_UNUSABLE",
      `request_id must match ${REQUEST_ID} because it names the request file; got ` +
        `${JSON.stringify(request.request_id)}.`
    );
  }

  // confirmed_by is forwarded as given. When it is absent the adapter names the owner; when it is
  // present but wrong, the adapter refuses. This door does not decide who the owner is.
  const payload = {
    kind,
    task_id: taskId,
    gate_id: gateId,
    request_id: rawId || null,
  };
  if (request.confirmed_by != null) payload.confirmed_by = String(request.confirmed_by);
  if (request.conversation_id != null) payload.conversation_id = String(request.conversation_id);

  const python = process.env.HANAKO_PYTHON || DEFAULT_PYTHON;
  const interpreter = fs.existsSync(python) ? python : "python";
  const adapter = process.env.HANAKO_GATE_ADAPTER || DEFAULT_ADAPTER;

  const run = spawnSync(interpreter, [adapter], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: ADAPTER_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });

  if (run.error && run.error.code === "ETIMEDOUT") {
    return refused(
      "GATE_ADAPTER_TIMEOUT",
      `the adapter did not answer within ${ADAPTER_TIMEOUT_MS / 1000}s; retrying with the same ` +
        "request_id is safe because the command_id is derived from it."
    );
  }
  if (run.error) {
    return refused("GATE_ADAPTER_UNAVAILABLE", `${run.error.code || ""} ${run.error.message}`.trim());
  }

  let answer = null;
  try {
    answer = JSON.parse(String(run.stdout || "").trim());
  } catch (e) {
    answer = null;
  }
  if (!answer || typeof answer !== "object") {
    return refused(
      "GATE_ADAPTER_NO_ANSWER",
      `the adapter wrote no readable JSON (exit=${run.status}). stderr tail: ${tail(run.stderr)}`
    );
  }
  return { ...answer, tool: TOOL_ENGINEERING_SUBMIT, adapter: adapter };
}
