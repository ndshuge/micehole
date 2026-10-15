/** Fingerprint-based result reuse. One fingerprint = one receipt file; no CAS/database. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { artifactAvailable } from "./artifact-core.mjs";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

export function fingerprintStep(spec) {
  const canonical = JSON.stringify(stable(spec));
  return createHash("sha256").update(canonical).digest("hex");
}

function dir(root) {
  const value = path.join(root, "work", "bridge", "cache-v1");
  fs.mkdirSync(value, { recursive: true });
  return value;
}

function file(root, fingerprint) {
  if (!/^[a-f0-9]{64}$/.test(String(fingerprint || ""))) throw new Error("Invalid cache fingerprint");
  return path.join(dir(root), `${fingerprint}.json`);
}

export function cachePut(root, fingerprint, payload) {
  const record = {
    schema: "hanako.cache.v1", fingerprint,
    capability: payload.capability || null,
    result: payload.result ?? null,
    artifact_refs: Array.isArray(payload.artifact_refs) ? payload.artifact_refs : [],
    validation: payload.validation || null,
    created_at: new Date().toISOString(),
  };
  const target = file(root, fingerprint);
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2));
  fs.renameSync(tmp, target);
  return record;
}

export function cacheGet(root, fingerprint) {
  const target = file(root, fingerprint);
  if (!fs.existsSync(target)) return null;
  const record = JSON.parse(fs.readFileSync(target, "utf8"));
  if (record.validation && record.validation !== "PASS") return null;
  if ((record.artifact_refs || []).some(id => !artifactAvailable(root, id))) return null;
  return record;
}
