/** Durable execution facts for vNext long-running work.
 *
 * This is not Runtime Truth and not a scheduler. It only records concrete execution
 * attempts so a reconnect can recover the handle and evidence.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const JOB_ID = /^job-[0-9]{13}-[a-f0-9]{8}$/;

function dirs(root) {
  const base = path.join(root, "work", "bridge", "jobs-v1");
  const byProcess = path.join(base, "by-process");
  fs.mkdirSync(byProcess, { recursive: true });
  return { base, byProcess };
}

function pathFor(root, jobId) {
  if (!JOB_ID.test(String(jobId || ""))) throw new Error("Invalid job id");
  return path.join(dirs(root).base, `${jobId}.json`);
}

function atomicJson(file, value) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

export function createJob(root, spec) {
  const now = new Date().toISOString();
  const jobId = `job-${Date.now()}-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const record = {
    schema: "hanako.job.v1",
    job_id: jobId,
    task_id: spec.task_id || null,
    recipe_id: spec.recipe_id || null,
    step_id: spec.step_id || null,
    capability: spec.capability,
    backend: spec.backend || null,
    resource_class: spec.resource_class || "LIGHT",
    state: spec.state || "QUEUED",
    process_id: spec.process_id ?? null,
    attempt: spec.attempt || 1,
    progress: spec.progress ?? null,
    artifacts: Array.isArray(spec.artifacts) ? spec.artifacts : [],
    error_class: spec.error_class || null,
    summary: spec.summary || "",
    metadata: spec.metadata && typeof spec.metadata === "object" ? { ...spec.metadata } : {},
    submitted_at: now,
    started_at: spec.started_at || null,
    finished_at: spec.finished_at || null,
    updated_at: now,
  };
  if (!record.capability) throw new Error("job capability is required");
  atomicJson(pathFor(root, jobId), record);
  if (record.process_id != null) bindProcess(root, jobId, record.process_id);
  return record;
}

export function getJob(root, jobId) {
  const file = pathFor(root, jobId);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function updateJob(root, jobId, changes) {
  const current = getJob(root, jobId);
  if (!current) throw new Error(`Job not found: ${jobId}`);
  const next = { ...current, ...changes, job_id: current.job_id, schema: current.schema, updated_at: new Date().toISOString() };
  atomicJson(pathFor(root, jobId), next);
  if (next.process_id != null) bindProcess(root, jobId, next.process_id);
  return next;
}

export function bindProcess(root, jobId, processId) {
  if (!Number.isInteger(Number(processId)) || Number(processId) <= 0) throw new Error("Invalid process id");
  if (!JOB_ID.test(String(jobId || ""))) throw new Error("Invalid job id");
  const file = path.join(dirs(root).byProcess, `${Number(processId)}.txt`);
  fs.writeFileSync(file, String(jobId));
}

export function jobForProcess(root, processId) {
  const file = path.join(dirs(root).byProcess, `${Number(processId)}.txt`);
  if (!fs.existsSync(file)) return null;
  const jobId = fs.readFileSync(file, "utf8").trim();
  return getJob(root, jobId);
}

export function updateJobByProcess(root, processId, changes) {
  const current = jobForProcess(root, processId);
  if (!current) return null;
  return updateJob(root, current.job_id, changes);
}

export function listJobs(root, { states = null, limit = 50 } = {}) {
  const { base } = dirs(root);
  const allowed = states ? new Set(states) : null;
  return fs.readdirSync(base, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".json"))
    .map(entry => JSON.parse(fs.readFileSync(path.join(base, entry.name), "utf8")))
    .filter(job => !allowed || allowed.has(job.state))
    .sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)))
    .slice(0, Math.max(1, Math.min(Number(limit) || 50, 200)));
}
