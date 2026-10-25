#!/usr/bin/env node
/** Inspect local Mice Hole per-call lifecycle logs; never infer ChatGPT UI receipt. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const QUIET_MS = 60_000;
export function summarizeCallTrace(events, { nowMs = Date.now(), sinceMs = 0, quietMs = QUIET_MS } = {}) {
  const map = new Map();
  for (const event of events) {
    if (!event || !event.call_id || !Number.isFinite(Date.parse(event.at))) continue;
    const when = Date.parse(event.at);
    if (when < sinceMs) continue;
    let call = map.get(event.call_id);
    if (!call) {
      call = { call_id: event.call_id, first_ms: when, last_ms: when,
        tool: null, operation: null, outcome: null, elapsed_ms: null,
        locally_written_bytes: null, stages: new Set() };
      map.set(event.call_id, call);
    }
    call.last_ms = Math.max(when, call.last_ms);
    call.first_ms = Math.min(when, call.first_ms);
    call.stages.add(event.stage);
    if (event.stage === "tool_dispatched") {
      call.tool = event.tool || null; call.operation = event.operation || null;
    }
    if (event.stage === "tool_result_ready") {
      call.outcome = event.outcome || null;
      call.elapsed_ms = event.elapsed_ms ?? null;
    }
    if (event.stage === "handler_unhandled") call.outcome = "internal_error";
    if (event.stage === "stdio_write_callback") call.locally_written_bytes = event.bytes ?? null;
  }
  const calls = [...map.values()].sort((a,b) => a.first_ms - b.first_ms);
  const counts = { total_calls: calls.length, locally_written: 0,
    currently_executing_or_recent: 0, backend_stalled: 0,
    stdio_write_stalled: 0, tool_errors: 0 };
  const exceptions = [];
  for (const call of calls) {
    const done = call.stages.has("stdio_write_callback");
    const ready = call.stages.has("tool_result_ready") || call.stages.has("handler_unhandled");
    const ageMs = Math.max(0, nowMs - call.last_ms);
    let state;
    if (done) { state = "local_stdio_written"; counts.locally_written++; }
    else if (ageMs < quietMs) { state = "currently_executing_or_recent"; counts.currently_executing_or_recent++; }
    else if (ready) { state = "stdio_write_stalled"; counts.stdio_write_stalled++; }
    else { state = "backend_stalled"; counts.backend_stalled++; }
    if (call.outcome && call.outcome !== "ok") counts.tool_errors++;
    if (state !== "local_stdio_written" || (call.outcome && call.outcome !== "ok")) {
      exceptions.push({ call_id: call.call_id, tool: call.tool, operation: call.operation,
        outcome: call.outcome, state, last_seen_at: new Date(call.last_ms).toISOString(),
        age_seconds: Math.round(ageMs / 1000) });
    }
  }
  return { ...counts, exceptions: exceptions.slice(-15),
    last_call: calls.length ? {
      call_id: calls.at(-1).call_id, tool: calls.at(-1).tool,
      outcome: calls.at(-1).outcome,
      local_stdio_written: calls.at(-1).stages.has("stdio_write_callback"),
      last_seen_at: new Date(calls.at(-1).last_ms).toISOString()
    } : null,
    limitation: "A local stdout callback proves only that Node finished writing its stream; it does not prove ChatGPT service receipt or iOS UI completion." };
}

export function inspectSession(root, pid, options = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("A positive numeric PID is required");
  const logDir = path.join(root, "work", "mouse-hole", "logs");
  const receiptFile = path.join(logDir, `mcp-session-${pid}.json`);
  const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
  if (receipt.pid !== pid) throw new Error("MCP receipt PID mismatch");
  if (!receipt.call_trace_file) return { session_pid: pid, trace_available: false, reason: "No call trace in this MCP session" };
  const traceFile = path.resolve(receipt.call_trace_file);
  const relative = path.relative(logDir, traceFile);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative) ||
      path.basename(traceFile).match(new RegExp(`^mcp-calls-${pid}-[0-9]+\\.ndjson$`)) === null) {
    throw new Error("Unexpected call trace path in receipt");
  }
  let corrupt_lines = 0;
  const entries = [];
  for (const f of [traceFile + ".1", traceFile]) {
    if (!fs.existsSync(f)) continue;
    const data = fs.readFileSync(f, "utf8");
    if (Buffer.byteLength(data) > 1100 * 1024) throw new Error("Trace segment exceeds bounded size");
    for (const line of data.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { entries.push(JSON.parse(line)); }
      catch { corrupt_lines++; }
    }
  }
  return { session_pid: pid, session_started_at: receipt.started_at,
    session_closed_at: receipt.closed_at ?? null, initialized: receipt.initialized,
    trace_available: true, corrupt_lines,
    ...summarizeCallTrace(entries, options) };
}

function cli() {
  const args = process.argv.slice(2);
  const flagValue = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const pid = Number(flagValue("--pid"));
  const root = path.resolve(flagValue("--root") || process.env.MOUSE_HOLE_WORKSPACE || "E:\\CHATGPT");
  const since = flagValue("--since");
  const sinceMs = since ? Date.parse(since) : 0;
  if (since && !Number.isFinite(sinceMs)) throw new Error("--since must be an ISO timestamp");
  console.log(JSON.stringify(inspectSession(root, pid, { sinceMs }), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { cli(); } catch (e) { process.stderr.write(String(e.message || e) + "\n"); process.exitCode = 1; }
}
