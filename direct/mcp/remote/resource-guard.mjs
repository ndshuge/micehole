/** Narrow single-machine resource guard for heavy local GPU jobs.
 * Not a scheduler: it is one bounded semaphore with an expiry.
 */
import fs from "node:fs";
import path from "node:path";

function guardFile(root) {
  const dir = path.join(root, "work", "bridge", "resource-guards");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "gpu-heavy.json");
}

export function currentHeavyGpu(root) {
  const file = guardFile(root);
  if (!fs.existsSync(file)) return null;
  try {
    const guard = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!guard.expires_at || Date.parse(guard.expires_at) <= Date.now()) {
      fs.rmSync(file, { force: true });
      return null;
    }
    return guard;
  } catch {
    fs.rmSync(file, { force: true });
    return null;
  }
}

export function acquireHeavyGpu(root, jobId, { ttlMs = 2 * 60 * 60 * 1000, backend = null } = {}) {
  const current = currentHeavyGpu(root);
  if (current && current.job_id !== jobId) return { ok: false, holder: current };
  const now = new Date();
  const record = {
    schema: "hanako.resource_guard.v1",
    resource: "GPU_HEAVY",
    job_id: jobId,
    backend,
    acquired_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlMs).toISOString(),
  };
  const file = guardFile(root);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2));
  fs.renameSync(tmp, file);
  return { ok: true, holder: record };
}

export function releaseHeavyGpu(root, jobId) {
  const file = guardFile(root);
  const current = currentHeavyGpu(root);
  if (!current) return false;
  if (current.job_id !== jobId) return false;
  fs.rmSync(file, { force: true });
  return true;
}
