/**
 * hanako_engineering_submit — the P3 door on the B2 remote surface.
 *
 * What this file does: takes one structured engineering request, writes it verbatim into a
 * per-request directory, runs the already-built P3 chain (`project-lab/scripts/p3_chat_run.py`,
 * which drives ChatEnvelope -> worktree -> verification -> result commit), and hands the receipt
 * back to the caller.
 *
 * What this file deliberately does NOT do: no permission judgement. It never inspects
 * `repository_path`, `changes`, `acceptance`, or any other field for safety, never builds a second
 * copy of the field whitelist, never decides what "dangerous" means. The screening authority is
 * `project_lab/application/engineering/chat_envelope.py`, reached through the script — one policy,
 * one place. A request that ought to be refused is written to disk *unchanged* and refused by the
 * chain, and the refusal comes back as the receipt.
 *
 * The only thing checked here is the request_id, and only because it names a directory: a string
 * that cannot be a path segment cannot be stored. A request that fails that check never reaches the
 * chain, and the refusal says so in those words.
 *
 * Where the pieces live (all under this bridge's root, no new queue, no new mailbox):
 *   <root>/work/bridge/engineering/requests/<request_id>/<request_id>.json   the request
 *   <root>/work/bridge/engineering/receipts/<request_id>/<request_id>.json             pass 0
 *   <root>/work/bridge/engineering/receipts/<request_id>/<request_id>.resume-N.json    pass N
 *   <root>/work/bridge/engineering/scratch/                                  the chain's scratch
 *
 * A receipt records one *pass*, never the request's fate, so "a receipt exists" is not by itself a
 * reason to skip the chain. A pass that has settled for good — the chain refused it, or the task
 * reached one of the chain's terminal states — is served from disk unchanged, as often as it is
 * asked for. A pass that has *not* settled is handed back to the chain, whose own replay rule reads
 * Runtime Truth: a Human Gate the owner approved after the first pass must be resumed, not
 * re-served. A resumed pass lands as `<request_id>.resume-N.json` beside the first receipt, which
 * is never rewritten, so this door answers with the newest pass and the request's history stays
 * readable in order.
 *
 * `spawnSync` means one submission at a time — the MCP server blocks for the duration of the task,
 * which is bounded by `timeout_seconds`.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { DEFAULT_WORKSPACE, bridgePaths } from "./bridge-core.mjs";

export const TOOL_ENGINEERING_SUBMIT = "hanako_engineering_submit";

const DEFAULT_PYTHON = "E:\\CHATGPT\\projects\\project-lab\\.venv\\Scripts\\python.exe";
const DEFAULT_SCRIPT = "E:\\CHATGPT\\projects\\project-lab\\scripts\\p3_chat_run.py";

const DEFAULT_TIMEOUT_SECONDS = 900;
const MIN_TIMEOUT_SECONDS = 30;
const MAX_TIMEOUT_SECONDS = 1800;
const OUTPUT_TAIL_CHARS = 3000;

/** The id is a directory name. That is the whole reason for this pattern. */
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * The chain's terminal task states, mirrored (`p3_chat_run.py` `_TERMINAL_TASK_STATES`). A task
 * here has concluded, so a pass that recorded it is the last word and serving it again is the whole
 * answer. This set is a *reading* of the chain's own rule, not a second policy: the chain stays the
 * only place that decides what a task's state is, and this door only asks whether the pass it holds
 * is already final.
 */
const TERMINAL_STATES = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

/** `<id>.json` is pass 0; `<id>.resume-N.json` is pass N; anything else is not this request's. */
function evidenceIndexOf(id, name) {
  if (name === `${id}.json`) return 0;
  const prefix = `${id}.resume-`;
  if (!name.startsWith(prefix) || !name.endsWith(".json")) return null;
  const digits = name.slice(prefix.length, -".json".length);
  if (!/^\d+$/.test(digits)) return null;
  const index = Number(digits);
  return index > 0 ? index : null;
}

/**
 * The newest pass this request has on disk, or null when none has landed yet.
 *
 * A resumed pass is written beside the first receipt rather than over it, so "the receipt" is only
 * well defined once the highest `N` is picked. Reading only `<id>.json` is what made a first pass
 * that stopped on a Human Gate look final.
 */
function latestEvidence(receiptDir, id) {
  let names;
  try {
    names = fs.readdirSync(receiptDir);
  } catch {
    return null;
  }
  let best = null;
  for (const name of names) {
    const index = evidenceIndexOf(id, name);
    if (index === null) continue;
    if (best === null || index > best.index) best = { index, file: path.join(receiptDir, name) };
  }
  return best;
}

/** Read one evidence file as a JSON object, or null when it is missing, unreadable or not an object. */
function readEvidence(file) {
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

/**
 * Has this request been decided for good, so that re-serving the record is the whole answer?
 *
 * Two ways: the chain refused it (asking again does not undo a refusal), or the task reached a
 * terminal state. Everything else is still open — most importantly a first pass that stopped on a
 * Human Gate the owner has since approved, which must be resumed. An absent or unreadable receipt
 * is undecided on purpose: the chain, not this door, is what reads Runtime Truth (`_replay_verdict`),
 * so an unclear record is handed to it rather than guessed at.
 */
function isDecided(evidence) {
  if (!evidence) return false;
  if (String(evidence.verdict || "").toUpperCase() === "REFUSED") return true;
  return TERMINAL_STATES.has(String(evidence.state || "").toUpperCase());
}

export function engineeringPaths(root = DEFAULT_WORKSPACE) {
  const base = process.env.HANAKO_B2_ENG_ROOT
    ? path.resolve(process.env.HANAKO_B2_ENG_ROOT)
    : path.join(bridgePaths(root).bridge, "engineering");
  return {
    base,
    requests: path.join(base, "requests"),
    receipts: path.join(base, "receipts"),
    scratch: path.join(base, "scratch"),
  };
}

function rel(root, target) {
  return path.relative(root, target).split(path.sep).join("/");
}

function tail(text) {
  const s = String(text || "");
  return s.length <= OUTPUT_TAIL_CHARS ? s : `…${s.slice(-OUTPUT_TAIL_CHARS)}`;
}

function refused(requestId, code, message, extra) {
  return {
    ok: false,
    tool: TOOL_ENGINEERING_SUBMIT,
    request_id: requestId,
    error: { code, message },
    ...(extra || {}),
  };
}

/**
 * Run one request through the chain. Returns a v1-shaped payload: the call always succeeds, and
 * "no" is carried in band as `ok:false` + `error.code`, with the receipt attached either way.
 */
export function submitEngineering(root, args = {}) {
  const request = args.request;
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return refused(
      null,
      "BAD_REQUEST",
      "`request` must be an object carrying the engineering fields. This door does not inspect " +
        "those fields; it only requires that they arrive as one object."
    );
  }

  const rawId = request.request_id;
  if (typeof rawId !== "string" || !REQUEST_ID.test(rawId)) {
    return refused(
      typeof rawId === "string" ? rawId : null,
      "REQUEST_ID_UNUSABLE",
      `request_id must match ${REQUEST_ID} because it names the request directory; ` +
        `got ${JSON.stringify(rawId)}. This is a file-name rule, not a policy decision: any other ` +
        "field is stored verbatim and judged by the chain."
    );
  }
  const id = rawId;

  const paths = engineeringPaths(root);
  const requestDir = path.join(paths.requests, id);
  const receiptDir = path.join(paths.receipts, id);
  const requestFile = path.join(requestDir, `${id}.json`);
  // Where the chain's *first* pass would write. A resumed pass lands beside it as `.resume-N.json`.
  const firstReceiptFile = path.join(receiptDir, `${id}.json`);

  fs.mkdirSync(requestDir, { recursive: true });
  fs.mkdirSync(receiptDir, { recursive: true });
  fs.mkdirSync(paths.scratch, { recursive: true });

  const prior = latestEvidence(receiptDir, id);
  const priorReceipt = prior ? readEvidence(prior.file) : null;
  const ranChain = !isDecided(priorReceipt);
  let durationMs = null;

  if (ranChain) {
    // Not settled: give it back to the chain. Only an absent request file is written; a later pass
    // reuses the stored one, so the document this request is answered against cannot be replaced by
    // a second submission that merely reuses the id.
    if (!fs.existsSync(requestFile)) {
      fs.writeFileSync(requestFile, JSON.stringify(request, null, 2), "utf8");
    }

    const python = process.env.HANAKO_PYTHON || DEFAULT_PYTHON;
    const script = process.env.HANAKO_P3_SCRIPT || DEFAULT_SCRIPT;
    const interpreter = fs.existsSync(python) ? python : "python";
    const asked = Number(args.timeout_seconds);
    const seconds = Math.min(
      Math.max(Number.isFinite(asked) ? asked : DEFAULT_TIMEOUT_SECONDS, MIN_TIMEOUT_SECONDS),
      MAX_TIMEOUT_SECONDS
    );

    const started = Date.now();
    const run = spawnSync(
      interpreter,
      [script, "--requests", requestDir, "--receipts", receiptDir, "--scratch", paths.scratch],
      {
        cwd: root,
        encoding: "utf8",
        timeout: seconds * 1000,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      }
    );
    durationMs = Date.now() - started;

    const trace = {
      request_path: rel(root, requestFile),
      receipt_path: rel(root, prior ? prior.file : firstReceiptFile),
      duration_ms: durationMs,
      exit_code: run.status,
      stdout_tail: tail(run.stdout),
      stderr_tail: tail(run.stderr),
    };

    if (run.error && run.error.code === "ETIMEDOUT") {
      return refused(
        id,
        "CHAIN_TIMEOUT",
        `the engineering chain did not finish within ${seconds}s; the task may still be running ` +
          "inside the chain's own scratch, so re-submitting the same request_id is safe (a receipt, " +
          "when it lands, is the record).",
        { result: { ...trace, duplicate: false } }
      );
    }

    const landed = latestEvidence(receiptDir, id);
    if (!landed) {
      return refused(
        id,
        "CHAIN_NO_RECEIPT",
        `the chain ran but wrote no receipt (exit=${run.status}` +
          `${run.error ? `, ${run.error.code || run.error.message}` : ""}). The stderr tail below is ` +
          "the chain's own words.",
        { result: { ...trace, duplicate: false } }
      );
    }
    // A new pass may not appear even though the chain ran: its replay rule can conclude that this
    // request has nothing left to do here (a task already terminal, a queue entry still running, a
    // gate still pending). That is a verdict of its own, and the record on disk is still the answer.
  }

  const served = ranChain ? latestEvidence(receiptDir, id) || prior : prior;
  const receipt = served ? readEvidence(served.file) : null;
  if (!receipt) {
    return refused(
      id,
      "RECEIPT_UNREADABLE",
      `a receipt exists for this request but is not readable as a JSON object: ${
        served ? rel(root, served.file) : "(none)"
      }`,
      { result: { receipt_path: served ? rel(root, served.file) : null } }
    );
  }
  // "duplicate" means this call did not add a pass: either the pass it holds was already final, or
  // the chain ran and concluded there was nothing to add.
  const duplicate = !ranChain || (prior !== null && served.index === prior.index);

  const evidence = {
    verdict: receipt.verdict || null,
    task_id: receipt.task_id || null,
    state: receipt.state || null,
    verification_outcome: receipt.verification_outcome || null,
    result_commit: receipt.result_commit || null,
    result_branches: receipt.result_branches || null,
    canonical_branch: receipt.canonical_branch || null,
    canonical_head_before: receipt.canonical_head_before || null,
    canonical_head_after: receipt.canonical_head_after || null,
    canonical_branch_unchanged: receipt.canonical_branch_unchanged ?? null,
    lease_recorded: receipt.lease_recorded ?? null,
    workspace_touched: receipt.workspace_touched ?? null,
    queued: receipt.queued ?? null,
    receipt_path: rel(root, served.file),
    request_path: rel(root, requestFile),
    resume_index: served.index,
    duplicate,
    duration_ms: durationMs,
    receipt,
  };

  if (receipt.verdict === "REFUSED") {
    return refused(
      id,
      receipt.reason_code || "REFUSED",
      receipt.detail || "the engineering chain refused this request",
      { result: evidence }
    );
  }

  return { ok: true, tool: TOOL_ENGINEERING_SUBMIT, request_id: id, result: evidence };
}
