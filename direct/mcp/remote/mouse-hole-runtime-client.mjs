import http from "node:http";

const HOST = "127.0.0.1";
const PORT = Number(process.env.MOUSE_HOLE_RUNTIME_PORT || 8792);
const AGENT = new http.Agent({ keepAlive: true, maxSockets: 12, maxFreeSockets: 6, timeout: 30000 });
const MAX_RESPONSE_BYTES = 96 * 1024 * 1024;

function normalizedTimeout(value) {
  return Math.max(1000, Math.min(Number(value) || 45000, 180000));
}

function requestJson(path, method = "GET", body = null, timeoutMs = 60000) {
  const payload = body === null ? null : JSON.stringify(body);
  const headers = { accept: "application/json" };
  if (payload !== null) {
    headers["content-type"] = "application/json";
    headers["content-length"] = Buffer.byteLength(payload);
  }
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: HOST, port: PORT, path, method,
      agent: AGENT, headers,
    }, response => {
      const chunks = [];
      let bytes = 0;
      response.on("data", chunk => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          request.destroy(new Error("Mouse Hole Runtime response exceeds size limit"));
          return;
        }
        chunks.push(chunk);
      });
      response.once("error", reject);
      response.once("end", () => {
        let data;
        try {
          data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          reject(new Error(`Mouse Hole Runtime returned invalid JSON (${response.statusCode})`));
          return;
        }
        resolve({ status: response.statusCode, data });
      });
    });
    request.setTimeout(normalizedTimeout(timeoutMs), () => {
      request.destroy(new Error("Mouse Hole Runtime timed out"));
    });
    request.once("error", reject);
    if (payload !== null) request.end(payload);
    else request.end();
  });
}

export async function mouseHoleRuntimeHealth(timeoutMs = 3000) {
  const { status, data } = await requestJson("/health", "GET", null, timeoutMs);
  if (status !== 200 || data?.ok !== true)
    throw new Error(data?.message || `Mouse Hole Runtime health failed (${status})`);
  return data;
}

export async function mouseHoleRuntimeCall(name, args = {}, timeoutMs = 60000) {
  const started = performance.now();
  const { status, data } = await requestJson("/call", "POST", { name, args }, timeoutMs);
  if (status !== 200 || data?.ok !== true) {
    const error = new Error(data?.message || data?.error || `Mouse Hole Runtime call failed (${status})`);
    if (data?.error) error.code = data.error;
    throw error;
  }
  if (data.result && typeof data.result === "object") {
    data.result.metadata = {
      ...(data.result.metadata || {}),
      local_http_roundtrip_ms: Math.round((performance.now() - started) * 100) / 100,
    };
  }
  return data.result;
}
