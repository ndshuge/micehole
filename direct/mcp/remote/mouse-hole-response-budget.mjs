/** Final serialized MCP envelope budget. Never silently replay a completed operation. */
export const MAX_MCP_RESPONSE_BYTES = 8 * 1024 * 1024;
export function serializeBoundedResponse(message, budget = MAX_MCP_RESPONSE_BYTES) {
  budget = Math.max(1024, Math.min(MAX_MCP_RESPONSE_BYTES, budget));
  const text = JSON.stringify(message);
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= budget) return { text, bytes, limited: false };
  let operation = "unknown", artifact;
  try {
    const payload = message.result?.structuredContent || JSON.parse(message.result?.content?.find(x => x.type === "text")?.text || "{}");
    operation = String(payload.operation || "unknown").slice(0, 100);
    if (typeof payload.path === "string") artifact = payload.path.slice(0, 500);
  } catch { /* Do not parse or persist opaque large content. */ }
  const failure = {
    ok: false, operation, failure: "response_too_large", retryable: false,
    response_bytes: bytes, response_budget_bytes: budget,
    execution_outcome: message.result?.isError === false ? "completed_before_response_limit" : "inspect_before_retry",
    reason: "The complete MCP response exceeds the transport budget. The operation is not replayed.",
    hint: "Read text/output in smaller pages; request explicit preview-photo:// or preview-region:// media. Inspect effects before repeating a mutation.",
    ...(artifact ? { artifact_path: artifact } : {}),
  };
  const bounded = message.result ? {
    jsonrpc: "2.0", id: message.id,
    result: { content: [{ type: "text", text: JSON.stringify(failure) }], isError: true },
  } : { jsonrpc: "2.0", id: message.id ?? null, error: { code: -32010, message: "MCP response exceeds transport budget" } };
  const result = JSON.stringify(bounded);
  if (Buffer.byteLength(result, "utf8") > budget) throw new Error("Compact budget failure exceeds minimum envelope budget");
  return { text: result, bytes: Buffer.byteLength(result, "utf8"), limited: true, originalBytes: bytes };
}
