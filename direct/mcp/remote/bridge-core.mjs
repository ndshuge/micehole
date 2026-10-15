/**
 * Shared bridge core — route B.
 *
 * Why this file exists: the remote tunnel surface and the local stdio bridge
 * must not each carry their own copy of the tool semantics. This module holds
 * the *implementation*; the servers hold only the surface (JSON-RPC plumbing,
 * tool list, audit).
 *
 * Consumers:
 *   - work/b-route/b0-status-server.mjs  (status only)   — historical anchor
 *   - work/b-route/b1-server.mjs         (status/read/pick) — current surface
 *
 * Contract (same as the local stdio bridge, deliberately):
 *   - workspace root defaults to E:\CHATGPT, overridable via HANAKO_WORKSPACE.
 *   - the bridge folder is <workspace>/work/bridge with inbox/ and outbox/.
 *   - "status" means: counts + the five newest JSON file names in each folder.
 *
 * Read policy (added for B1, 2026-09-22):
 *   - every path must resolve, literally *and* after link resolution, inside
 *     the workspace root;
 *   - any path component matching DENY_SEGMENT refuses the whole path, so
 *     work/b-route/secrets/control-plane.key is unreachable even though it
 *     lives inside the workspace;
 *   - directory listings drop denied entries rather than advertising them.
 *
 * Still not wired: projects/openhanako-runtime/mcp/hanako-mcp.mjs keeps its own
 * inline copy of status/read/pick. Switching it to import this module changes
 * the production stdio MCP and is therefore a Human Gate item — recorded, not
 * done here. Until then these two implementations can drift; that is a known,
 * accepted boundary of this round, not an oversight.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_WORKSPACE = process.env.MOUSE_HOLE_WORKSPACE || process.env.HANAKO_WORKSPACE || process.cwd();
export const BRIDGE_SUBPATH = path.join("work", "bridge");
export const MAX_READ = 40_000;
export const MAX_LIST = 300;
export const MAX_PICK = 5;

/** Resolve the workspace root and the three bridge folders under it. */
export function bridgePaths(root) {
  const workspace = path.resolve(root || DEFAULT_WORKSPACE);
  const bridge = path.join(workspace, BRIDGE_SUBPATH);
  return {
    workspace,
    bridge,
    inbox: path.join(bridge, "inbox"),
    outbox: path.join(bridge, "outbox"),
  };
}

export function ensureBridgeDirs(paths) {
  for (const dir of [paths.bridge, paths.inbox, paths.outbox]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Newest `limit` *.json file names in a folder, oldest first. Empty on error. */
export function recentJsonFiles(dir, limit) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .slice(-limit);
  } catch {
    return [];
  }
}

/** The single payload B0 exposes. Field names match the existing hanako_status. */
export function readStatus(root, verdict) {
  const paths = bridgePaths(root);
  return {
    ok: true,
    tool: "hanako_status",
    serverTime: new Date().toISOString(),
    host: os.hostname(),
    workspace: paths.workspace,
    bridge: paths.bridge,
    inboxCount: recentJsonFiles(paths.inbox, Number.MAX_SAFE_INTEGER).length,
    outboxCount: recentJsonFiles(paths.outbox, Number.MAX_SAFE_INTEGER).length,
    latestInbox: recentJsonFiles(paths.inbox, 5),
    latestOutbox: recentJsonFiles(paths.outbox, 5),
    verdict: verdict || "Bridge reachable.",
  };
}

/* ------------------------------------------------------------------ *
 * B1 read policy
 * ------------------------------------------------------------------ */

/**
 * Names that are never readable over the remote surface, matched
 * case-insensitively against every path component (file or directory).
 * Kept deliberately blunt: a false positive costs one refused read, a false
 * negative costs a credential.
 */
const DENY_SEGMENT = [
  /^ephemeral-sessions$/i, // session identifiers and identity bindings are private Bridge state
  /^b2-audit.*\.jsonl$/i, // audit binds those identifiers to ChatGPT identities
  /^\.env(\..+)?$/i, // .env, .env.local, .env.production
  /^credentials.*$/i, // credentials, credentials.json
  /^secrets?$/i, // secret, secrets (directory)
  /^secrets.*$/i, // secrets.json
  /^id_rsa.*$/i,
  /^id_ed25519.*$/i,
  /^token.*$/i, // token, token.txt, tokens.json
  /^api[-_]?key.*$/i, // api-key*, api_key*
  /^.*\.key$/i, // control-plane.key
  /^.*\.pem$/i,
];

/** True when a single path component is on the deny list. */
export function deniedSegment(name) {
  return DENY_SEGMENT.some((re) => re.test(String(name)));
}

/** True when *any* component of a workspace-relative path is denied. */
export function isDeniedPath(relPath) {
  return String(relPath)
    .split(/[\\/]+/)
    .filter(Boolean)
    .some(deniedSegment);
}

/** Resolve a user-supplied path and refuse anything that escapes `root`. */
export function resolveUnder(root, candidate) {
  const raw = String(candidate == null || candidate === "" ? "." : candidate);
  const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  const rel = path.relative(root, abs);
  if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) {
    throw new Error(`path escapes the allowed root: ${candidate}`);
  }
  return abs;
}

/**
 * Second gate: resolve symlinks, junctions and 8.3 short names, then re-check
 * containment. `resolveUnder` only compares the *written* path, so a link
 * planted inside the workspace could still point at E:\Hanako, and a short name
 * (SECRET~1) could dodge a rule that matches on the visible name. Both are
 * resolved here. Returns the canonical path and its workspace-relative form.
 */
export function realpathInside(root, abs) {
  let realRoot;
  try {
    realRoot = fs.realpathSync.native(root);
  } catch {
    realRoot = path.resolve(root);
  }
  let realAbs;
  try {
    realAbs = fs.realpathSync.native(abs);
  } catch {
    throw new Error(`not found: ${abs}`);
  }
  const rel = path.relative(realRoot, realAbs);
  if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) {
    throw new Error(`path leaves the workspace through a link: ${abs}`);
  }
  return { realRoot, realAbs, rel };
}

/**
 * Read a file or list a directory inside the workspace, read-only.
 * Throws (never returns partial content) on any policy violation.
 *
 * Order matters: containment, then canonicalise, then apply the deny rules to
 * the *canonical* path. Testing the deny list before resolution would let a link
 * or a short name carry a denied file straight through.
 */
export function readTarget(root, candidate, maxChars) {
  const abs = resolveUnder(root, candidate);
  const { realAbs, rel } = realpathInside(root, abs);

  if (isDeniedPath(rel)) {
    throw new Error(`path is not readable over the remote surface: ${candidate}`);
  }

  const stat = fs.statSync(realAbs);

  if (stat.isDirectory()) {
    const entries = fs
      .readdirSync(realAbs, { withFileTypes: true })
      .filter((e) => !deniedSegment(e.name))
      .slice(0, MAX_LIST)
      .map((e) => ({ name: e.name, type: e.isDirectory() ? "dir" : "file" }));
    return {
      ok: true,
      tool: "hanako_read",
      kind: "directory",
      path: realAbs,
      count: entries.length,
      entries,
    };
  }

  const limit = Number(maxChars) > 0 ? Number(maxChars) : MAX_READ;
  const raw = fs.readFileSync(realAbs, "utf8");
  const truncated = raw.length > limit;
  return {
    ok: true,
    tool: "hanako_read",
    kind: "file",
    path: realAbs,
    chars: raw.length,
    truncated,
    content: truncated ? raw.slice(0, limit) : raw,
  };
}

/**
 * Collect the newest results Hanako left in the outbox. Strictly read-only:
 * nothing is deleted, acked, moved, retried or executed. The files stay put so
 * a later call sees exactly the same list.
 */
export function pickResults(root, limit) {
  const paths = bridgePaths(root);
  const n =
    Number(limit) > 0 ? Math.min(Math.floor(Number(limit)), 50) : MAX_PICK;
  const names = recentJsonFiles(paths.outbox, n);
  const results = names.map((f) => {
    const full = path.join(paths.outbox, f);
    try {
      return { file: f, content: JSON.parse(fs.readFileSync(full, "utf8")) };
    } catch {
      try {
        return { file: f, content: fs.readFileSync(full, "utf8") };
      } catch {
        return { file: f, error: "unreadable" };
      }
    }
  });
  return { ok: true, tool: "hanako_pick_results", count: results.length, results };
}
