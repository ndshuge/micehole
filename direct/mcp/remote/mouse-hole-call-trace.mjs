/** Privacy-bounded, best-effort lifecycle evidence for direct stdio MCP calls.
 * A completed stdout write is NOT proof that ChatGPT received or displayed it.
 * Never log tool arguments, commands, paths, results, prompt text or credentials.
 */
import fs from "node:fs";
import path from "node:path";

const MAX_BYTES = 1024 * 1024;
const FIELD_NAMES = new Set(["tool", "operation", "outcome", "elapsed_ms", "bytes", "limited", "pending"]);

export function createCallTracer(root, options = {}) {
  const enabled = options.enabled ?? (
    process.env.MOUSE_HOLE_DIAGNOSTIC_PROBE !== "1" &&
    process.env.MOUSE_HOLE_CALL_TRACE_DISABLED !== "1"
  );
  const pid = options.pid ?? process.pid;
  const directory = options.directory ?? process.env.MOUSE_HOLE_CALL_TRACE_DIR ??
    path.join(root, "work", "mouse-hole", "logs");
  const file = path.join(directory, `mcp-calls-${pid}-${Date.now()}.ndjson`);
  let sequence = 0;
  let failureCount = 0;

  function record(stage, callId = null, details = {}) {
    if (!enabled) return;
    const safe = {};
    for (const [key, value] of Object.entries(details)) {
      if (!FIELD_NAMES.has(key)) continue;
      if ((key === "tool" && /^mouse_hole_[a-z_]+$/.test(value)) ||
          (key === "operation" && /^[a-z_]{1,40}$/.test(value)) ||
          (key === "outcome" && ["ok", "tool_error", "rpc_error", "internal_error"].includes(value)) ||
          (["elapsed_ms", "bytes", "pending"].includes(key) && Number.isFinite(value) && value >= 0) ||
          (key === "limited" && typeof value === "boolean")) {
        safe[key] = value;
      }
    }
    const line = JSON.stringify({
      at: new Date().toISOString(), pid, stage,
      ...(callId ? { call_id: callId } : {}), ...safe,
    }) + "\n";
    try {
      fs.mkdirSync(directory, { recursive: true });
      const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
      if (size + Buffer.byteLength(line) > MAX_BYTES) {
        fs.rmSync(`${file}.1`, { force: true });
        fs.renameSync(file, `${file}.1`);
      }
      fs.appendFileSync(file, line, { encoding: "utf8", mode: 0o600 });
    } catch {
      failureCount++;
      // Diagnostics must never interrupt an execution or corrupt MCP stdout.
      if (failureCount === 1) process.stderr.write("Mouse Hole call trace write failed\n");
    }
  }

  function start(tool, operation) {
    const callId = `${pid}:${++sequence}`;
    // The tool/operation are from the fixed MCP schema, never raw user input.
    record("tool_started", callId);
    return callId;
  }

  return { file: enabled ? file : null, record, start };
}
