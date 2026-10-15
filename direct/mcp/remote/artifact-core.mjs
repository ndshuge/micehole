/** Lightweight artifact receipts. No artifact database and no content store. */
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isDeniedPath } from "./bridge-core.mjs";

const ARTIFACT_ID = /^artifact-[0-9]{13}-[a-f0-9]{8}$/;

function dir(root) {
  const value = path.join(root, "work", "bridge", "artifacts-v1");
  fs.mkdirSync(value, { recursive: true });
  return value;
}

function safeArtifactPath(root, value) {
  const base = fs.realpathSync.native(root);
  const abs = path.resolve(path.isAbsolute(value) ? value : path.join(base, value));
  const real = fs.realpathSync.native(abs);
  const rel = path.relative(base, real);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error("Artifact must remain inside workspace");
  if (isDeniedPath(rel)) throw new Error("Credential-like artifact path is unavailable");
  return abs;
}

function artifactFile(root, artifactId) {
  if (!ARTIFACT_ID.test(String(artifactId || ""))) throw new Error("Invalid artifact id");
  return path.join(dir(root), `${artifactId}.json`);
}

function atomic(file, value) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

export function fileSha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function recordArtifact(root, spec) {
  if (!spec.kind) throw new Error("artifact kind is required");
  if (!spec.path) throw new Error("artifact path is required");
  const file = safeArtifactPath(root, spec.path);
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error("artifact path must be a file");
  const artifactId = `artifact-${Date.now()}-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const record = {
    schema: "hanako.artifact.v1",
    artifact_id: artifactId,
    kind: spec.kind,
    path: file,
    sha256: fileSha256(file),
    size_bytes: stat.size,
    producer_capability: spec.producer_capability || null,
    producer_job_id: spec.producer_job_id || null,
    parent_artifact_ids: Array.isArray(spec.parent_artifact_ids) ? spec.parent_artifact_ids : [],
    task_id: spec.task_id || null,
    validation: spec.validation || null,
    created_at: new Date().toISOString(),
  };
  atomic(artifactFile(root, artifactId), record);
  return record;
}

export function getArtifact(root, artifactId) {
  const file = artifactFile(root, artifactId);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function artifactAvailable(root, artifactId) {
  const record = getArtifact(root, artifactId);
  if (!record || !record.path || !fs.existsSync(record.path)) return false;
  return fileSha256(record.path) === record.sha256;
}
