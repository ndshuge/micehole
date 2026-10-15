#!/usr/bin/env node
/**
 * Remote Control Surface with the original seven tools and Computer Tools v1.
 *
 *   hanako_status              read      is the bridge alive
 *   hanako_read                read      inspect the workspace
 *   hanako_list_tasks          read      what has Hanako been asked to do
 *   hanako_task_status         read      where is one task now
 *   hanako_pick_results        read      collect what the runtime finished
 *   hanako_drop_task           write     hand over one task, asynchronously
 *   hanako_engineering_submit  write     hand over one engineering request, synchronously
 *
 * B3 froze the original list as v1 (`projects/openhanako-runtime/docs/REMOTE_CONTROL_SURFACE_V1.md`). The
 * point of the freeze is that the list stops growing when the *runtime* grows: a new executor, a new
 * task stage or a new model changes what a tool reports, never which tools exist. Adding a tool is
 * a v2 event, and the surface must not be extended per feature — the eleven-tool ambition includes
 * five names (cancel / resume / list_approvals / approve / reject) that are deliberately NOT here,
 * because the runtime cannot yet settle a gate or cancel a running task safely, and a tool that only
 * says "not implemented" teaches a client to believe in a capability that is not there.
 *
 * The seventh original tool is `hanako_engineering_submit`, which carries
 * one structured request to the P3 chat-envelope chain and returns that chain's receipt
 * (`projects/openhanako-runtime/docs/REMOTE_CONTROL_SURFACE_V2_ENGINEERING_SUBMIT.md`). It adds no
 * capability of its own — no permission rule, no executor, no queue — and it screens nothing: every
 * judgement it could have made was already made by the chain, and a second copy of those rules here
 * would be a second place to be wrong. Computer Tools v1 is the explicitly requested extension.
 *
 * Where this fits (route B, `ChatGPT → Secure MCP Tunnel → Hanako`):
 *
 *   ChatGPT (web / desktop / mobile)
 *            →  OpenAI-hosted tunnel endpoint
 *            →  tunnel-client (outbound-only, spawned by the owner)
 *            →  THIS process, over stdio (`--mcp.command node ...`)
 *            →  bridge-core.mjs (status/read/pick) · b2-core.mjs (drop)
 *            →  workspace / bridge / runtime truth
 *
 * B1 was a read-only console: "show me what Hanako did". B2 adds exactly one thing — the ability to
 * *ask* for work — and nothing else. `hanako_drop_task` writes one request document into
 * `work/bridge/inbox` and stops there: it does not execute, does not run git or a shell, and cannot
 * reach the runtime. The runtime's resident consumer (`projects/openhanako-runtime/scripts/
 * b2_inbox_consumer.py`) picks the request up, the runtime's own validator admits it, the runtime's
 * own executor registry runs it, and the result is published into `work/bridge/outbox`, where
 * `hanako_pick_results` already reads. Reading and asking use the same two mailboxes; no new queue,
 * no new bus, no new tool for getting results back.
 *
 * Contracts (do not relax):
 *   - stdout carries protocol messages ONLY; every log line goes to stderr.
 *   - `tools/list` returns the seven original tools plus Computer Tools v1. Anything else is refused with -32602, including
 *     `hanako_write`, which must stay invisible on this surface.
 *   - `server/discover` (2026-07-28) is answered with an unhandled-method error, which is the
 *     legacy signal a dual-era client's stdio probe looks for: the client then falls back to the
 *     `initialize` handshake this surface actually serves. It must NOT be answered with a
 *     DiscoverResult — the probe reads that as "this server is modern", and advertising only
 *     initialize-era revisions there leaves the client with no mutually supported version.
 *     `initialize` / `tools/list` / `tools/call` are untouched.
 *   - every tool call appends one audit line to work/bridge/b2-audit.jsonl, including refusals.
 *     Audit records the request, never the payload: `hanako_read` logs the path but not the content;
 *     `hanako_pick_results` logs task ids but not result bodies; `hanako_drop_task` logs the task id,
 *     the request_id and the goal's *length* — never the goal text.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

import {
  DEFAULT_WORKSPACE,
  MAX_READ,
  bridgePaths,
  ensureBridgeDirs,
  pickResults,
  readStatus,
  readTarget,
} from "./bridge-core.mjs";
import { REQUEST_SCHEMA, REMOTE_INTENTS, buildRequest, writeRequest } from "./b2-core.mjs";
import { TOOL_ENGINEERING_SUBMIT, submitEngineering } from "./b2-engineering.mjs";
import { isGateRequest, submitGate } from "./b2-gate.mjs";
import { COMPUTER_TOOLS, computerCall } from "./computer-adapter.mjs";
import { VNEXT_TOOLS, vnextCall } from "./vnext-surface.mjs";
import { currentHeavyGpu } from "./resource-guard.mjs";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  ORDER,
  STATUS_VOCABULARY,
  TOOL_LIST_TASKS,
  TOOL_TASK_STATUS,
  listTasks,
  taskStatus,
} from "./queue-core.mjs";

const ROOT = process.env.HANAKO_WORKSPACE || DEFAULT_WORKSPACE;
const paths = bridgePaths(ROOT);
ensureBridgeDirs(paths);
// The smoke driver points these at its own files, so running a test can never truncate the
// production trail. Same arrangement as B1.
const AUDIT_FILE = process.env.HANAKO_B2_AUDIT
  ? path.resolve(process.env.HANAKO_B2_AUDIT)
  : path.join(paths.bridge, "b2-audit.jsonl");
const LOG_FILE = process.env.HANAKO_B2_LOG
  ? path.resolve(process.env.HANAKO_B2_LOG)
  : path.join(paths.bridge, "b2-bridge.log");
// Diagnostic-only lifecycle/call trace. This is deliberately separate from the existing
// business audit and records no tool arguments or result payloads.
const SESSION_TRACE_FILE = process.env.HANAKO_SESSION_TRACE
  ? path.resolve(process.env.HANAKO_SESSION_TRACE)
  : path.join(paths.bridge, "session-trace.jsonl");
const LOCAL_SESSION_ID = randomUUID();
const SESSION_CREATED_MS = Date.now();
let SESSION_CLOSED = false;
let SESSION_CLOSE_REASON = null;
const TOOL_EXCEPTIONS = new Map();

// Process lifecycle ownership is scoped to this stdio server instance. A process started through
// hanako_start_process belongs to the connection that launched it until it finishes or is stopped.
// If multiple distinct remote OpenAI sessions are observed on one stdio connection, disconnect
// cleanup fails safe and leaves managed processes untouched.
const OWNED_PROCESSES = new Map();
const OBSERVED_REMOTE_SESSIONS = new Set();

const SERVER_INFO = { name: "hanako-bridge-b2", version: "0.4.0" };
const PROTOCOL_FALLBACK = "2025-06-18";
// The revisions this surface actually speaks: the `initialize` handshake. This is a legacy server,
// and stdio-era detection keys on that: the `server/discover` probe in `handle` answers with an
// unhandled-method error so a dual-era client falls back to `initialize` instead of staying modern.
const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18"];

const T_STATUS = "hanako_status";
const T_READ = "hanako_read";
const T_LIST = TOOL_LIST_TASKS;
const T_TASK = TOOL_TASK_STATUS;
const T_PICK = "hanako_pick_results";
const T_DROP = "hanako_drop_task";
/** v2 increment (2026-09-22), declared where its implementation lives. */
const T_ENG = TOOL_ENGINEERING_SUBMIT;
const SURFACE_MODE = (() => {
  const explicit = String(process.env.HANAKO_SURFACE_MODE || "").trim().toLowerCase();
  if (explicit) {
    if (!["legacy", "preview", "vnext"].includes(explicit)) throw new Error("HANAKO_SURFACE_MODE must be legacy, preview, or vnext");
    return explicit;
  }
  return process.env.HANAKO_VNEXT_SURFACE === "1" ? "preview" : "legacy";
})();
const VNEXT_ENABLED = SURFACE_MODE !== "legacy";
const VNEXT_ALIASES_ENABLED = SURFACE_MODE === "vnext" || (VNEXT_ENABLED && process.env.HANAKO_VNEXT_ALIASES === "1");
const VNEXT_ALIAS_MAP = Object.freeze({
  hanako_write: "hanako_write_file",
  hanako_patch: "hanako_edit_file",
  hanako_run: "hanako_run_command",
  hanako_process_start: "hanako_start_process",
  hanako_process_stop: "hanako_kill_process",
  hanako_task_submit: T_DROP,
  hanako_task_list: T_LIST,
});
const VNEXT_ALIAS_NAMES = Object.keys(VNEXT_ALIAS_MAP);

const LEGACY_EXPOSED = [
  T_STATUS, T_READ, T_LIST, T_TASK, T_PICK, T_DROP, T_ENG,
  ...COMPUTER_TOOLS.map(tool => tool.name),
];

const VNEXT_UNCHANGED = [
  T_STATUS,
  T_READ,
  "hanako_search",
  "hanako_process_status",
  "hanako_process_output",
  "hanako_validate",
  "hanako_git_status",
  "hanako_git_diff",
  T_TASK,
  T_ENG,
  "hanako_godot",
];

const PREVIEW_EXPOSED = [
  ...LEGACY_EXPOSED,
  ...VNEXT_TOOLS.map(tool => tool.name),
  ...(VNEXT_ALIASES_ENABLED && SURFACE_MODE !== "vnext" ? VNEXT_ALIAS_NAMES : []),
];

const FINAL_VNEXT_EXPOSED = [
  ...VNEXT_UNCHANGED,
  ...VNEXT_ALIAS_NAMES,
  ...VNEXT_TOOLS.map(tool => tool.name),
];

// The surface order is declared once per migration mode. vNext replaces legacy
// synonyms instead of stacking them indefinitely.
const EXPOSED = SURFACE_MODE === "legacy"
  ? LEGACY_EXPOSED
  : (SURFACE_MODE === "preview" ? PREVIEW_EXPOSED : FINAL_VNEXT_EXPOSED);

/** Names intentionally hidden in the selected mode. */
const NOT_EXPOSED = SURFACE_MODE === "vnext"
  ? ["hanako_pick_results", "hanako_read_file", "hanako_write_file", "hanako_edit_file", "hanako_run_command", "hanako_start_process", "hanako_kill_process", T_LIST, T_DROP]
  : ["hanako_write"];

const TOOL_DEFS = [
  {
    name: T_STATUS,
    title: "Hanako status",
    description:
      "Read-only. Returns the bridge server time, host, workspace root, and how many tasks are " +
      "waiting in the inbox versus how many results are ready in the outbox. Call this first to " +
      "confirm the bridge is alive.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: T_READ,
    title: "Read a file or list a directory",
    description:
      "Read-only. Reads a text file or lists a directory inside the Hanako workspace. Pass a path " +
      "relative to the workspace root, for example 'work/state/foo.md'. Long files are truncated; " +
      "the response says so when that happens. Paths outside the workspace, paths that escape via " +
      "a symlink or junction, and credential-like names (.env, secrets, *.key, *.pem, id_rsa*, " +
      "token*, api_key*) are refused.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Path relative to the workspace root, or an absolute path inside the workspace.",
        },
        maxChars: {
          type: "number",
          description: `Optional truncation limit in characters. Defaults to ${MAX_READ}.`,
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: T_PICK,
    title: "Pick up results from Hanako",
    description:
      "Read-only. Returns the most recent files Hanako's runtime published into work/bridge/outbox, " +
      "newest last: the structured result for a task that ran, or a refusal record for one that was " +
      "refused. Nothing is consumed: the outbox is not modified, deleted or acknowledged, so calling " +
      "again returns the same results.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "How many recent results to return. Defaults to 5.",
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: T_DROP,
    title: "Hand a task to Hanako",
    description:
      "Delivers one structured task to Hanako's runtime and returns its task id immediately. This " +
      "call does NOT wait for the task to run, and it never runs anything itself: it writes one " +
      "request document into work/bridge/inbox, and Hanako's runtime consumer picks it up, validates " +
      "it and executes it. Collect the result later with hanako_pick_results. " +
      "Required: request_id (your idempotency key — the same request_id always names the same task, " +
      "so a retry cannot create a second one), goal, and acceptance (what would make it done). " +
      "Optional: context, constraints, non_goals, intent_kind, model, thinking. " +
      "risk is fixed to 'low' and the workspace is fixed to this bridge's root: this door refuses a " +
      "higher risk or a different workspace rather than ignoring them, and a task that needs a Human " +
      "Gate cannot be declared here at all.",
    inputSchema: {
      type: "object",
      properties: {
        request_id: {
          type: "string",
          description:
            "Idempotency key, [A-Za-z0-9][A-Za-z0-9._-]{2,55}. Reuse it when retrying a delivery; " +
            "use a new one for a new task.",
        },
        goal: { type: "string", description: "What the task must achieve. Declarative, never a command." },
        acceptance: {
          description: "What would make it done. A string, or an object of criteria.",
          anyOf: [{ type: "string" }, { type: "object" }],
        },
        context: { type: "string", description: "Optional background the task needs." },
        constraints: {
          type: "array",
          items: { type: "string" },
          description: "Optional things the task must respect.",
        },
        non_goals: {
          type: "array",
          items: { type: "string" },
          description: "Optional things this task explicitly must not do.",
        },
        intent_kind: {
          type: "string",
          enum: REMOTE_INTENTS,
          description:
            `Which registered executor runs it. Only ${JSON.stringify(REMOTE_INTENTS)} is reachable ` +
            "from this door; the runtime's registry is closed and an unregistered kind is refused.",
        },
        risk: {
          type: "string",
          enum: ["low"],
          description:
            "Fixed to 'low'. A higher risk must be submitted locally, where a human can issue an " +
            "approval reference this bridge cannot verify.",
        },
        workspace: {
          type: "string",
          description: `Must equal this bridge's root (${ROOT}) or be omitted.`,
        },
        model: { type: "string", description: "Optional hint, recorded on the task. Not authority." },
        thinking: { type: "string", description: "Optional hint, recorded on the task. Not authority." },
      },
      required: ["request_id", "goal", "acceptance"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: T_LIST,
    title: "List Hanako's tasks",
    description:
      "Read-only. Returns brief rows for the tasks in Hanako's runtime queue, oldest first by " +
      "default: task_id, a derived title, status, timestamps, risk, source and whether a result " +
      "exists. No task body is returned — use hanako_task_status for one task's detail. " +
      "`status` filters on the coarse vocabulary (queued, running, done, failed, refused, unknown); " +
      "the runtime's own status word is reported as runtime_status on every row, so nothing is " +
      "hidden behind the mapping. Reserved-but-not-yet-reachable states are not accepted as a " +
      "filter, because filtering on a state the runtime cannot produce would imply it exists.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: STATUS_VOCABULARY,
          description: "Optional. Return only tasks in this coarse status.",
        },
        limit: {
          type: "number",
          description: `Optional page size, 1..${MAX_LIMIT}. Defaults to ${DEFAULT_LIMIT}.`,
        },
        offset: {
          type: "number",
          description: "Optional rows to skip, >= 0. Defaults to 0. Use next_offset to page.",
        },
        order: {
          type: "string",
          enum: ORDER,
          description:
            "Optional. 'asc' (default) is the runtime's own scan order by (created_at, task_id); " +
            "'desc' reverses it, so the newest tasks come first.",
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: T_TASK,
    title: "Where one task is",
    description:
      "Read-only. Returns the present state of one task from its documents: coarse status, the " +
      "runtime's own status word, the stage it reached (submitted / acknowledged / completed / " +
      "refused_at_intake), whether a result is available, one line saying why it stopped if it did, " +
      "the evidence file names, and pointers to its documents. It never invents a task: an id the " +
      "queue does not hold is answered NOT_FOUND.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description:
            "The task id returned by hanako_drop_task, e.g. 'rcm-<your request_id>'. Matched " +
            "exactly; it is used as a file name, so anything else is refused.",
        },
      },
      required: ["task_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: T_ENG,
    title: "Submit an engineering task to Hanako's P3 chain",
    description:
      "Carries ONE structured engineering request to Hanako's existing P3 chat-envelope chain " +
      "(chat-envelope screening -> isolated worktree -> verification -> result commit) and returns " +
      "that chain's receipt. Unlike hanako_drop_task this call waits for the chain to finish and " +
      "answers with the outcome, because the receipt is the point of this door. " +
      "For standard P3 submissions, `request` is written verbatim: the P3 surface screens nothing, so every refusal rule you can " +
      "meet (field whitelist, protected paths, eligible roots, scope, acceptance, duration " +
      "ceiling) belongs to the chain, and a request the chain refuses comes back as ok:false with " +
      "the chain's own reason_code and detail, plus the receipt, and with nothing written anywhere. " +
      "Fields the chain accepts: request_id, task_id, repository_path, objective, allowed_paths, " +
      "changes, acceptance, canonical_branch, base_commit, commit_message, priority, risk_class, " +
      "forbidden_paths, max_duration_seconds, requires_human_gate. Dangerous names (push, deploy, " +
      "merge, target_branch, secrets, approvals, executor_class, ...) are refused by the chain, not " +
      "dropped quietly here. The eligible roots and the 600s default duration ceiling are the " +
      "chain's own and are not selectable from this door. For an explicitly requested temporary " +
      "engineering session use request.kind=EPHEMERAL_ENGINEERING_SESSION with operation=enable, " +
      "confirmation=ENABLE_EPHEMERAL_ENGINEERING. It defaults OFF, lasts four hours, and is bound " +
      "to the ChatGPT identity. Pass the returned session_id for status, disable, git.inspect, " +
      "python.syntax, python.pytest, sqlite.select, source.identity, source.patch, or candidate.commit. Repositories are selected " +
      "by project-lab or openhanako-runtime. Registered pytest runs only on a clean base candidate " +
      "before any Chat patch; python.syntax parses patched Python without executing it. No shell, merge, push, deploy, canonical write, gate " +
      "decision, or secret access is available through this session.",
    inputSchema: {
      type: "object",
      properties: {
        request: {
          type: "object",
          description:
            "A standard P3 engineering request, passed to that chain unchanged; or an " +
            "EPHEMERAL_ENGINEERING_SESSION operation. For standard P3 requests: changes MUST be an array " +
            "of {file:string, old:string, new:string, expected_hits?:integer}; acceptance MUST be an object " +
            "with commands?:string[][], contains?:[string,string][], not_contains?:[string,string][]; " +
            "priority, when present, MUST be an integer; base_commit, when present, MUST be a full 40-character " +
            "lowercase hexadecimal Git SHA (short SHAs are invalid). Omit priority to use NORMAL.",
        },
        timeout_seconds: {
          type: "integer",
          description:
            "How long this call may wait for the chain, 30-1800 seconds (default 900). On timeout " +
            "the request stays submitted; re-sending the same request_id returns the receipt once " +
            "it exists instead of running the chain a second time.",
        },
      },
      required: ["request"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
];

TOOL_DEFS.push(...COMPUTER_TOOLS);
if (VNEXT_ENABLED) {
  TOOL_DEFS.push(...VNEXT_TOOLS);
}
if (VNEXT_ALIASES_ENABLED) {
  for (const [alias, target] of Object.entries(VNEXT_ALIAS_MAP)) {
    const source = TOOL_DEFS.find(tool => tool.name === target);
    if (!source) throw new Error(`Missing vNext alias target: ${alias} -> ${target}`);
    TOOL_DEFS.push({
      ...source,
      name: alias,
      title: `${alias} (vNext alias)`,
      description: `vNext compatibility alias for ${target}. Uses the same implementation and policy boundary.`,
    });
  }
}
const BY_NAME = new Map(TOOL_DEFS.map((tool) => [tool.name, tool]));
const TOOLS = EXPOSED.map((name) => BY_NAME.get(name));

// Declared once and used by both `initialize` and `server/discover`: two copies of the guidance a
// client shows would be two copies to keep in step.
const INSTRUCTIONS =
  "Hanako Remote Control Surface with Computer Tools v1. Original tools: hanako_status, " +
  "hanako_read, hanako_list_tasks, hanako_task_status, hanako_pick_results, hanako_drop_task, " +
  "hanako_engineering_submit. hanako_drop_task delivers one structured task to Hanako's " +
  "runtime asynchronously and never executes anything itself; hanako_list_tasks and " +
  "hanako_task_status say what the runtime did with it; collect results with " +
  "hanako_pick_results. hanako_engineering_submit hands one structured engineering request to " +
  "Hanako's P3 chat-envelope chain and waits for that chain's receipt; standard P3 refusals " +
  "arrive in band carrying the chain's own reason_code. Computer tools directly use Desktop " +
  "Commander for workspace file edits, commands, Git, validation, Godot, and persistent processes. " +
  "An explicit Ephemeral Engineering Session is available through the same " +
  "engineering tool using request.kind=EPHEMERAL_ENGINEERING_SESSION. Call operation=enable " +
  "with confirmation=ENABLE_EPHEMERAL_ENGINEERING only after the user explicitly asks to enable " +
  "it. Sessions default OFF, expire in four hours, and can be disabled. Never infer permission " +
  "from transport or from the tool's presence.";

function submitEphemeral(request, identity) {
  const python = "E:\\CHATGPT\\projects\\project-lab\\.venv\\Scripts\\python.exe";
  const script = path.join(import.meta.dirname, "ephemeral-engineering.py");
  const env = {};
  for (const key of ["SYSTEMROOT", "WINDIR", "TEMP", "TMP"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.HANAKO_WORKSPACE = ROOT;
  env.PYTHONPATH = path.join(ROOT, "projects", "project-lab", "src");
  env.PYTHONIOENCODING = "utf-8";
  env.PYTHONDONTWRITEBYTECODE = "1";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = "NUL";
  env.GIT_CONFIG_COUNT = "2";
  env.GIT_CONFIG_KEY_0 = "core.hooksPath";
  env.GIT_CONFIG_VALUE_0 = "NUL";
  env.GIT_CONFIG_KEY_1 = "core.fsmonitor";
  env.GIT_CONFIG_VALUE_1 = "false";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_PAGER = "cat";
  env.PATH = "D:\\Program Files\\代码工具\\Git\\cmd;C:\\Windows\\System32";
  if (process.env.HANAKO_EPHEMERAL_STATE) env.HANAKO_EPHEMERAL_STATE = process.env.HANAKO_EPHEMERAL_STATE;
  const child = spawnSync(python, [script], {
    input: JSON.stringify({ request, identity }),
    encoding: "utf8",
    env,
    timeout: 150_000,
    maxBuffer: 128 * 1024,
    windowsHide: true,
  });
  if (child.error || child.status !== 0) {
    return { ok: false, error: { code: "ENGINEERING_BACKEND_FAILED", message: "Engineering backend failed" } };
  }
  try {
    const answer = JSON.parse(child.stdout);
    return { ...answer, tool: T_ENG };
  } catch {
    return { ok: false, error: { code: "ENGINEERING_BACKEND_INVALID", message: "Engineering backend returned invalid data" } };
  }
}

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(" ")}`;
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}
  process.stderr.write(line + "\n");
}

/** Minimal audit trail: what was called, by whom, when, and how it ended. */
function audit(record) {
  try {
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(record) + "\n");
  } catch {}
}

function trace(record) {
  const event = { timestamp: new Date().toISOString(), session_id: LOCAL_SESSION_ID, ...record };
  try {
    fs.appendFileSync(SESSION_TRACE_FILE, JSON.stringify(event) + "\n");
  } catch (e) {
    log(`TRACE_WRITE_ERROR ${e?.message || e}`);
  }
}

function observeRemoteSession(identity) {
  if (identity?.session) OBSERVED_REMOTE_SESSIONS.add(identity.session);
}

function rememberOwnedProcess(processId, identity, args = {}) {
  if (!Number.isInteger(processId) || processId <= 0) return;
  const owner = {
    process_id: processId,
    remote_session: identity?.session || null,
    remote_subject: identity?.subject || null,
    cwd: args.cwd || null,
    started_at: new Date().toISOString(),
  };
  OWNED_PROCESSES.set(processId, owner);
  trace({ event: "process.owned", ...owner });
}

function forgetOwnedProcess(processId, reason) {
  const owner = OWNED_PROCESSES.get(processId);
  if (!owner) return;
  OWNED_PROCESSES.delete(processId);
  trace({ event: "process.released", process_id: processId, release_reason: reason, owner_session: owner.remote_session });
}

async function cleanupOwnedProcesses(reason) {
  const processIds = [...OWNED_PROCESSES.keys()];
  if (!processIds.length) return { attempted: 0, stopped: [], failed: [], skipped: false };
  if (OBSERVED_REMOTE_SESSIONS.size > 1) {
    const skipReason = "ambiguous_multi_session_connection";
    trace({
      event: "process.cleanup_skipped",
      cleanup_reason: reason,
      process_ids: processIds,
      observed_remote_session_count: OBSERVED_REMOTE_SESSIONS.size,
      skip_reason: skipReason,
    });
    return { attempted: 0, stopped: [], failed: [], skipped: true, skip_reason: skipReason };
  }

  const stopped = [];
  const failed = [];
  for (const processId of processIds) {
    try {
      const status = await computerCall(ROOT, "hanako_process_status", { process_id: processId });
      if (status.running) {
        let terminated = false;
        if (process.platform === "win32") {
          const treeKill = spawnSync("taskkill.exe", ["/PID", String(processId), "/T", "/F"], {
            encoding: "utf8",
            windowsHide: true,
            timeout: 15_000,
          });
          terminated = treeKill.status === 0;
          trace({ event: "process.tree_kill", process_id: processId, ok: terminated, exit_code: treeKill.status });
        }
        if (!terminated) await computerCall(ROOT, "hanako_kill_process", { process_id: processId });
      }
      stopped.push(processId);
      forgetOwnedProcess(processId, status.running ? "connection_cleanup" : "already_finished");
    } catch (error) {
      failed.push({ process_id: processId, error: String(error?.message || error) });
    }
  }
  trace({ event: "process.cleanup", cleanup_reason: reason, attempted: processIds.length, stopped, failed });
  return { attempted: processIds.length, stopped, failed, skipped: false };
}

function closeSession(reason, evidence = {}) {
  if (SESSION_CLOSED) return;
  SESSION_CLOSED = true;
  SESSION_CLOSE_REASON = reason;
  trace({
    event: "session.closed",
    connector_id: SOURCE === "unknown" ? null : SOURCE,
    duration_ms: Date.now() - SESSION_CREATED_MS,
    close_reason: reason,
    ...evidence,
  });
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const err = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
const text = (payload) => ({ content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] });
const fail = (message) => ({ content: [{ type: "text", text: String(message) }], isError: true });

/** Identity hints the ChatGPT client attaches to tools/call (observed 2026-09-21). */
function identityOf(params) {
  const meta = (params && params._meta) || {};
  const subject = meta["openai/subject"] || null;
  const session = meta["openai/session"] || null;
  // Tunnel calls arrive as bare tools/call with no MCP initialize, so clientInfo never lands on this
  // path. The openai/* keys in _meta are the real evidence that a call came through the tunnel.
  let source = SOURCE;
  let via = "initialize.clientInfo";
  if (source === "unknown") {
    if (subject || session) {
      source = "openai-mcp";
      via = "meta.openai";
    } else {
      via = "unidentified";
    }
  }
  return { source, subject, session, via };
}

let SOURCE = "unknown";

/** Task ids carried by a result, for the audit trail — never the body. */
function taskIdsOf(payload) {
  return (payload.results || []).map((r) => {
    const c = r && r.content;
    if (c && typeof c === "object" && c.id) return String(c.id);
    if (c && typeof c === "object" && c.taskId) return String(c.taskId);
    if (c && typeof c === "object" && c.task_id) return String(c.task_id);
    return r && r.file ? String(r.file) : "unknown";
  });
}

async function callTool(name, args, identity, requestId) {
  args = args || {};
  observeRemoteSession(identity);
  const requestedName = name;

  if (VNEXT_ALIASES_ENABLED && requestedName === "hanako_process_stop") {
    const status = await computerCall(ROOT, "hanako_process_status", { process_id: args.process_id });
    if (!status.running) {
      return {
        payload: {
          ok: false,
          state: "failed",
          error_class: "policy_denied",
          summary: "process_id is not a Hanako-managed active session",
          process_id: args.process_id,
        },
        auditExtra: { process_id: args.process_id || null, ownership_check: "rejected" },
      };
    }
    const stopped = await computerCall(ROOT, "hanako_kill_process", { process_id: args.process_id });
    forgetOwnedProcess(args.process_id, "explicit_stop");
    return {
      payload: { ...stopped, state: "cancelled", summary: "Hanako-managed process session stopped" },
      auditExtra: { process_id: args.process_id || null, ownership_check: "managed_session" },
    };
  }

  const aliasTarget = VNEXT_ALIASES_ENABLED ? VNEXT_ALIAS_MAP[name] : null;
  if (aliasTarget) name = aliasTarget;

  if (VNEXT_ENABLED && VNEXT_TOOLS.some(tool => tool.name === name)) {
    const vnextResult = await vnextCall(ROOT, name, args);
    const richContent = vnextResult.__mcp_content || null;
    if (richContent) delete vnextResult.__mcp_content;
    return { payload: vnextResult, content: richContent, auditExtra: {
      operation: args.operation || null,
      component: args.component || null,
      path: args.path || args.blend_path || null,
    } };
  }

  if (COMPUTER_TOOLS.some(tool => tool.name === name)) {
    const computerResult = await computerCall(ROOT, name, args);
    if (name === "hanako_start_process" && computerResult.process_id && computerResult.running) {
      rememberOwnedProcess(computerResult.process_id, identity, args);
    } else if (name === "hanako_kill_process" && args.process_id) {
      forgetOwnedProcess(args.process_id, "explicit_kill");
    } else if ((name === "hanako_process_output" || name === "hanako_process_status") && args.process_id) {
      if (computerResult.exit_code !== undefined || computerResult.running === false) {
        forgetOwnedProcess(args.process_id, "process_finished");
      }
    }
    const richContent = computerResult.__mcp_content || null;
    if (richContent) delete computerResult.__mcp_content;
    return { payload: computerResult, content: richContent, auditExtra: {
      cwd: args.cwd || null,
      path: args.path || null,
      process_id: args.process_id || null,
      command_kind: args.command ? String(args.command).trim().split(/\s+/)[0].slice(0, 40) : null,
      command_sha256: args.command ? (await import("node:crypto")).createHash("sha256").update(args.command).digest("hex") : null,
    } };
  }

  if (name === T_STATUS) {
    const base = readStatus(ROOT, "Bridge reachable over the B2 remote surface.");
    const adapters = {};
    if (VNEXT_ENABLED) {
      const probes = [
        ["blender", "hanako_blender"],
        ["comfyui", "hanako_comfyui"],
        ["three_d", "hanako_3d"],
        ["browser", "hanako_browser"],
      ];
      const health = await Promise.all(probes.map(async ([key, tool]) => {
        try {
          const probe = await vnextCall(ROOT, tool, { operation: "status" });
          return [key, {
            ok: probe?.ok === true,
            state: probe?.state || (probe?.ok === true ? "succeeded" : "unavailable"),
            summary: probe?.summary || null,
          }];
        } catch (error) {
          return [key, {
            ok: false,
            state: "failed",
            summary: String(error?.message || error),
          }];
        }
      }));
      for (const [key, value] of health) adapters[key] = value;
    }
    return {
      payload: {
        ...base,
        surface: {
          mode: SURFACE_MODE,
          tool_count: EXPOSED.length,
          vnext_enabled: VNEXT_ENABLED,
        },
        deployment: {
          server_name: SERVER_INFO.name,
          server_version: SERVER_INFO.version,
          pid: process.pid,
          node: process.version,
        },
        adapters,
        active_heavy_job: currentHeavyGpu(ROOT),
      },
    };
  }

  if (name === T_READ) {
    return { payload: readTarget(ROOT, args.path, args.maxChars) };
  }

  if (name === T_LIST) {
    const payload = listTasks(ROOT, args, requestId);
    return {
      payload,
      auditExtra: {
        filter_status: args.status ?? null,
        requested_limit: args.limit ?? null,
        requested_offset: args.offset ?? null,
        requested_order: args.order ?? null,
      },
    };
  }

  if (name === T_TASK) {
    const payload = taskStatus(ROOT, args, requestId);
    return {
      payload,
      auditExtra: {
        // The id is echoed only when the surface accepted its shape; otherwise the raw string is
        // recorded truncated, so the audit can still say what was asked for.
        task_id: payload.result && payload.result.task ? payload.result.task.task_id : null,
        requested_task_id: String(args.task_id ?? "").slice(0, 120),
        matched: !!(payload.result && payload.result.task),
      },
    };
  }

  if (name === T_PICK) {
    return { payload: pickResults(ROOT, args.limit) };
  }

  if (name === T_DROP) {
    const request = buildRequest(args, identity, ROOT);
    const written = writeRequest(ROOT, request);
    return {
      payload: {
        ok: true,
        tool: T_DROP,
        taskId: written.taskId,
        request_id: request.request_id,
        document: `work/bridge/inbox/${written.file}`,
        request_schema: REQUEST_SCHEMA,
        duplicate: !written.created,
        status: "submitted",
        note: written.created
          ? "Delivered. Hanako's runtime consumer will pick this up; collect the result with hanako_pick_results."
          : "Already delivered under this request_id; the existing task stands and nothing was written again.",
      },
      auditExtra: {
        task_id: written.taskId,
        idempotency_key: request.request_id,
        duplicate: !written.created,
        goal_chars: String(request.contract.goal).length,
      },
    };
  }

  if (name === T_ENG) {
    const request = args.request && typeof args.request === "object" ? args.request : null;
    if (request && request.kind === "EPHEMERAL_ENGINEERING_SESSION") {
      const payload = submitEphemeral(request, identity);
      return {
        payload,
        auditExtra: {
          session_operation: typeof request.operation === "string" ? request.operation.slice(0, 40) : null,
          session_id: typeof request.session_id === "string" && /^[0-9a-f]{32}$/.test(request.session_id)
            ? request.session_id : (payload.result && payload.result.session_id) || null,
          repository: typeof request.repository === "string" && ["project-lab", "openhanako-runtime"].includes(request.repository)
            ? request.repository : null,
        },
      };
    }
    // Existing P3/Gate routing remains behind the same tool, chosen by request.kind. The tool list
    // and every schema stay frozen (the surface is still seven tools): a Gate request is routed to
    // project-lab's Human Gate authority and never reaches the P3 chain, and every other request is
    // still the P3 chain's business. The adapter decides nothing about gates; it only routes.
    if (isGateRequest(request)) {
      const gatePayload = submitGate(args);
      return {
        payload: gatePayload,
        auditExtra: {
          idempotency_key: (request && request.request_id) || null,
          request_fields: request ? Object.keys(request).sort().join(",").slice(0, 300) : null,
          gate_command_id: gatePayload.command_id || null,
          gate_task_id: gatePayload.task_id || null,
          gate_id: gatePayload.gate_id || null,
          gate_status: gatePayload.status || null,
        },
      };
    }
    const payload = submitEngineering(ROOT, args);
    return {
      payload,
      // The audit records that a request was made, never the request itself: field *names* only,
      // plus the objective's length. Same rule as hanako_drop_task, which logs goal_chars and not
      // the goal, and hanako_read, which logs the path and not the content.
      auditExtra: {
        idempotency_key: (request && request.request_id) || null,
        request_fields: request ? Object.keys(request).sort().join(",").slice(0, 300) : null,
        objective_chars:
          request && typeof request.objective === "string" ? request.objective.length : null,
      },
    };
  }

  return null;
}

async function dispatchMessage(msg, traceId = null) {
  const { id, method, params } = msg || {};

  // 2026-07-28 `server/discover`. The stdio backward-compatibility probe classifies a server by how
  // it answers this: a `DiscoverResult` means "modern", any other error means "legacy". This surface
  // serves the legacy `initialize` handshake, so it must answer with an unhandled-method error and
  // let a dual-era client (ChatGPT, Codex) fall back. Answering with a DiscoverResult once branded
  // this legacy server "modern" while advertising only initialize-era revisions, and a dual-era
  // client — left with no mutually supported version — stopped before `initialize`, which surfaced
  // as a connector-creation failure. The log line is kept so the probe still shows in the trail.
  if (method === "server/discover") {
    const meta = (params && params._meta) || {};
    const requested =
      meta["io.modelcontextprotocol/protocolVersion"] ||
      (params && params.protocolVersion) ||
      null;
    log(`IN server/discover requested=${requested || "unspecified"} -> -32601 legacy-signal`);
    return err(id, -32601, `Method not found: ${method}`);
  }

  if (method === "initialize") {
    const protocolVersion = (params && params.protocolVersion) || PROTOCOL_FALLBACK;
    SOURCE = (params && params.clientInfo && params.clientInfo.name) || "unknown";
    log(
      `IN initialize clientProtocol=${protocolVersion} clientInfo=${JSON.stringify(
        (params && params.clientInfo) || null
      )}`
    );
    return ok(id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: INSTRUCTIONS,
    });
  }

  if (method === "notifications/initialized" || method === "initialized") return null;
  if (method === "notifications/cancelled") return null;
  if (method === "ping") return ok(id, {});

  if (method === "tools/list") {
    log(`IN tools/list -> ${TOOLS.length} tools: ${EXPOSED.join(",")}`);
    return ok(id, { tools: TOOLS });
  }

  if (method === "tools/call") {
    const wanted = params && params.name;
    const identity = identityOf(params);
    const stamp = new Date().toISOString();

    if (!EXPOSED.includes(wanted)) {
      const reason = NOT_EXPOSED.includes(wanted)
        ? `Tool exists locally but is not exposed on the B2 remote surface: ${wanted}`
        : `Tool not exposed on the B2 remote surface: ${wanted}`;
      log(`REFUSE tools/call name=${wanted}`);
      audit({
        request_id: id ?? null,
        action: wanted ?? null,
        ...identity,
        timestamp: stamp,
        status: "refused",
        reason,
      });
      return err(id, -32602, reason);
    }

    let args = params && params.arguments;
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        args = {};
      }
    }

    // Audit metadata is chosen per tool so no payload is ever written down.
    const extra = {};
    if (wanted === T_READ) extra.requested_path = (args && args.path) ?? null;
    if (wanted === T_PICK) extra.requested_limit = (args && args.limit) ?? null;

    try {
      const out = await callTool(wanted, args || {}, identity, id);
      if (!out) return err(id, -32602, `Tool not exposed on the B2 remote surface: ${wanted}`);
      const payload = out.payload;
      // A v1 tool answers a refusal in band (`ok:false` + `error.code`) instead of throwing: the
      // call itself succeeded, and "no" is a fact the caller has to be able to branch on. The audit
      // still records it as a refusal, so the trail reads the same way for both generations.
      const inBandRefusal = !!(payload && payload.ok === false);

      const note = {};
      if (wanted === T_READ) {
        note.result = payload.kind;
        note.truncated = !!payload.truncated;
      }
      if (wanted === T_PICK) {
        note.count = payload.count;
        note.task_ids = taskIdsOf(payload);
      }
      if (wanted === T_LIST) {
        // v1 tools carry their payload under `result`, so the audit reads it from there.
        note.count = payload.result ? payload.result.count : null;
        note.total = payload.result ? payload.result.total : null;
      }
      if (wanted === T_TASK && payload.result && payload.result.task) {
        note.task_ids = [payload.result.task.task_id];
        note.task_state = payload.result.task.status;
        note.stage = payload.result.task.current_stage;
      }
      if (wanted === T_ENG) {
        const evidence = (payload && payload.result) || {};
        note.verdict = evidence.verdict || null;
        note.result_commit = evidence.result_commit || null;
        note.canonical_unchanged = evidence.canonical_branch_unchanged ?? null;
        note.duplicate = evidence.duplicate ?? null;
      }
      log(
        `OUT ${wanted}${wanted === T_PICK ? ` count=${payload.count}` : ""}${
          wanted === T_READ ? ` kind=${payload.kind}` : ""
        }${wanted === T_DROP ? ` task=${payload.taskId} duplicate=${payload.duplicate}` : ""}${
          wanted === T_LIST
            ? ` count=${payload.result ? payload.result.count : 0}/${payload.result ? payload.result.total : 0}`
            : ""
        }${
          wanted === T_TASK && payload.result && payload.result.task
            ? ` task=${payload.result.task.task_id} status=${payload.result.task.status}`
            : ""
        }${inBandRefusal ? ` refused=${payload.error?.code || payload.exit_code || "failed"}` : ""}${
          wanted === T_ENG
            ? ` verdict=${(payload.result && payload.result.verdict) || "?"} commit=${
                (payload.result && payload.result.result_commit) || "none"
              }`
            : ""
        }`
      );
      audit({
        request_id: id ?? null,
        action: wanted,
        ...identity,
        ...extra,
        ...(out.auditExtra || {}),
        ...note,
        timestamp: stamp,
        status: inBandRefusal ? "refused" : "ok",
        ...(inBandRefusal
          ? {
              refusal_code: (payload.error && payload.error.code) || null,
              reason: (payload.error && payload.error.message) || "",
            }
          : {}),
      });
      if (out.content) {
        return ok(id, { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }, ...out.content] });
      }
      return ok(id, text(payload));
    } catch (e) {
      const reason = (e && e.message) || String(e);
      const code = (e && e.code) || null;
      const diagnosticException = {
        name: e?.name || "Error",
        message: reason,
        stack: e?.stack || null,
      };
      if (traceId) TOOL_EXCEPTIONS.set(traceId, diagnosticException);
      log(`TOOL_ERROR ${wanted}: ${COMPUTER_TOOLS.some(tool => tool.name === wanted) ? "computer backend failure" : reason}`);
      audit({
        request_id: id ?? null,
        action: wanted,
        ...identity,
        ...extra,
        ...(code ? { refusal_code: code } : {}),
        ...(wanted === T_DROP && args && args.request_id
          ? { idempotency_key: String(args.request_id), task_id: null }
          : {}),
        timestamp: stamp,
        status: "refused",
        reason: COMPUTER_TOOLS.some(tool => tool.name === wanted) ? "computer backend failure" : reason,
      });
      return ok(id, fail(reason));
    }
  }

  if (method === "resources/list") return ok(id, { resources: [] });
  if (method === "resources/templates/list") return ok(id, { resourceTemplates: [] });
  if (method === "resources/read") return err(id, -32602, "No resources are exposed by this server.");
  if (method === "prompts/list") return ok(id, { prompts: [] });
  if (method === "completion/complete") return ok(id, { completion: { values: [] } });
  if (method === "logging/setLevel") return ok(id, {});

  log(`IN UNHANDLED ${method}`);
  return err(id, -32601, `Method not found: ${method}`);
}

async function handle(msg) {
  const { id, method, params } = msg || {};
  if (method === "tools/call") {
    const traceId = randomUUID();
    const toolName = params && params.name ? String(params.name) : null;
    const identity = identityOf(params);
    const requestMs = Date.now();
    trace({ event: "session.active", connector_id: identity.source === "unknown" ? null : identity.source });
    trace({
      event: "tool.call.started",
      trace_id: traceId,
      request_id: id ?? null,
      tool_name: toolName,
      connector_id: identity.source === "unknown" ? null : identity.source,
      connector_session_fingerprint: identity.session
        ? createHash("sha256").update(String(identity.session)).digest("hex").slice(0, 16)
        : null,
      request_timestamp: new Date(requestMs).toISOString(),
    });
    try {
      const response = await dispatchMessage(msg, traceId);
      const responseMs = Date.now();
      const protocolFailure = !!(response && response.error);
      const toolFailure = !!(response && response.result && response.result.isError);
      const exception = TOOL_EXCEPTIONS.get(traceId) || null;
      TOOL_EXCEPTIONS.delete(traceId);
      let semanticFailure = false;
      try {
        const resultText = response?.result?.content?.find((item) => item.type === "text")?.text;
        semanticFailure = JSON.parse(resultText || "null")?.ok === false;
      } catch {}
      trace({
        event: "tool.call.finished",
        trace_id: traceId,
        request_id: id ?? null,
        tool_name: toolName,
        connector_id: identity.source === "unknown" ? null : identity.source,
        request_timestamp: new Date(requestMs).toISOString(),
        response_timestamp: new Date(responseMs).toISOString(),
        duration_ms: responseMs - requestMs,
        outcome: protocolFailure || toolFailure || semanticFailure ? "failure" : "success",
        failure_kind: protocolFailure
          ? "protocol_error"
          : (toolFailure ? "tool_error" : (semanticFailure ? "tool_refusal" : null)),
        exception,
      });
      return response;
    } catch (e) {
      const responseMs = Date.now();
      trace({
        event: "tool.call.finished",
        trace_id: traceId,
        request_id: id ?? null,
        tool_name: toolName,
        connector_id: identity.source === "unknown" ? null : identity.source,
        request_timestamp: new Date(requestMs).toISOString(),
        response_timestamp: new Date(responseMs).toISOString(),
        duration_ms: responseMs - requestMs,
        outcome: "failure",
        failure_kind: "server_exception",
        exception: { name: e?.name || "Error", message: e?.message || String(e), stack: e?.stack || null },
      });
      throw e;
    }
  }
  const response = await dispatchMessage(msg);
  if (method === "initialize") {
    trace({ event: "session.active", connector_id: SOURCE === "unknown" ? null : SOURCE });
  }
  return response;
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
const pending = new Set();

rl.on("line", (line) => {
  const work = (async () => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    log(`IN UNPARSEABLE ${trimmed.slice(0, 200)}`);
    send(err(null, -32700, "Parse error"));
    return;
  }

  const messages = Array.isArray(parsed) ? parsed : [parsed];
  for (const m of messages) {
    const response = await handle(m);
    if (response) send(response);
  }
  })();
  pending.add(work);
  work.finally(() => pending.delete(work)).catch(e => log(`REQUEST_ERROR ${e?.message || e}`));
});

rl.on("close", async () => {
  await Promise.allSettled([...pending]);
  log("stdin closed, cleaning owned processes");
  const cleanup = await cleanupOwnedProcesses("client_disconnect");
  log("stdin closed, exiting");
  closeSession("client_disconnect", {
    close_evidence: "stdio_stdin_eof",
    classification_confidence: "transport_boundary_only",
    process_cleanup: cleanup,
  });
  process.exit(0);
});

// The monitor observes uncaught exceptions without changing Node's default termination behavior.
process.on("uncaughtExceptionMonitor", (error, origin) => {
  const details = {
    exception_name: error?.name || "Error",
    exception_message: error?.message || String(error),
    exception_stack: error?.stack || null,
    origin: String(origin || "unknown"),
  };
  trace({ event: "server.exception", disconnect_class: "server_exception", ...details });
  closeSession("server_exception", details);
});

process.on("exit", (code) => {
  closeSession(SESSION_CLOSE_REASON || "unknown", {
    exit_code: code,
    close_evidence: SESSION_CLOSE_REASON ? "previously_classified" : "process_exit_event",
  });
});

log(
  `hanako-bridge-b2 stdio server ready (workspace=${ROOT}) pid=${process.pid} node=${process.version} ` +
    `version=${SERVER_INFO.version} protocol=${SUPPORTED_VERSIONS[0]}`
);
trace({
  event: "session.created",
  connector_id: SOURCE === "unknown" ? null : SOURCE,
  process_id: process.pid,
  server_name: SERVER_INFO.name,
  server_version: SERVER_INFO.version,
});
