import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isUtf8 } from "node:buffer";
import { isDeniedPath } from "./bridge-core.mjs";

// Direct, bounded file primitives. DC remains available for images, directories,
// exceptional file types and persistent process sessions.
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

function inside(root, input, create = false) {
  if (typeof input !== "string" || !input.trim() || input.includes("\0")) throw new Error("Valid path required");
  const base = fs.realpathSync.native(root);
  const file = path.resolve(base, input);
  const rel = path.relative(base, file);
  const outside = value => value === ".." || value.startsWith(".." + path.sep) || path.isAbsolute(value);
  if (outside(rel) || isDeniedPath(rel)) throw new Error("Path outside workspace or credential-like path");
  let cursor = file;
  while (!fs.existsSync(cursor)) {
    const upper = path.dirname(cursor);
    if (upper === cursor) throw new Error("Path has no existing ancestor");
    cursor = upper;
  }
  const real = fs.realpathSync.native(cursor);
  if (outside(path.relative(base, real))) throw new Error("Path escapes workspace through linked directory");
  // Do not let a symlink/junction in the requested path silently redirect a mutation.
  let part = base;
  for (const segment of rel.split(path.sep).filter(Boolean)) {
    part = path.join(part, segment);
    if (fs.existsSync(part) && fs.lstatSync(part).isSymbolicLink()) throw new Error("Linked path refused");
  }
  if (!create && !fs.existsSync(file)) throw new Error("Path not found");
  return file;
}

function replaceAtomic(file, data) {
  const temp = file + ".mouse-hole-" + randomUUID() + ".tmp";
  try {
    fs.writeFileSync(temp, data, { flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
  }
}

function textFile(root, file, create = false) {
  const abs = inside(root, file, create);
  if (fs.existsSync(abs)) {
    const stat = fs.statSync(abs);
    if (!stat.isFile()) return null; // Let Desktop Commander handle directories.
    if (stat.nlink > 1) throw new Error("Hardlinked file refused");
    if (stat.size > MAX_TEXT_BYTES) return null; // Retain DC for large files.
  }
  return abs;
}

export function nativeRead(root, args) {
  if (typeof args.path !== "string" || /^(?:screen|window|image|resource):\/\//.test(args.path)) return null;
  const file = textFile(root, args.path);
  if (!file) return null;
  const raw = fs.readFileSync(file);
  if (raw.includes(0) || !isUtf8(raw)) return null; // Binary/file previews stay with existing adapter.
  const lines = raw.toString("utf8").split(/\r?\n/);
  const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
  const length = Math.max(1, Math.min(1000, Math.floor(Number(args.length) || 200)));
  const selected = lines.slice(offset, offset + length);
  return { ok: true, path: file, truncated: offset + selected.length < lines.length, output: "[Reading " + selected.length + " lines from line " + offset + " (total: " + lines.length + " lines)]\n\n" + selected.join("\n") };
}

export function nativeWrite(root, args) {
  if (typeof args.content !== "string") throw new Error("Text content required");
  if (Buffer.byteLength(args.content) > MAX_TEXT_BYTES) throw new Error("Text exceeds native write limit");
  const file = textFile(root, args.path, true);
  if (!file) return null;
  // Preserve Desktop Commander's no-implicit-overwrite contract.
  if (fs.existsSync(file)) {
    const current = fs.readFileSync(file, "utf8");
    if (current !== args.content && current.length > 0) throw new Error("Existing nonempty file; use mouse_hole_patch for edits");
    if (current === args.content) return { ok: true, path: file, output: "File already has the requested content" };
  } else if (!fs.existsSync(path.dirname(file))) {
    throw new Error("Parent directory must exist");
  }
  replaceAtomic(file, args.content);
  return { ok: true, path: file, output: "Successfully wrote " + Buffer.byteLength(args.content) + " bytes" };
}

export function nativePatch(root, args) {
  if (typeof args.old_string !== "string" || !args.old_string.length) throw new Error("old_string required");
  if (typeof args.new_string !== "string") throw new Error("new_string required");
  const file = textFile(root, args.path);
  if (!file) return null;
  const raw = fs.readFileSync(file);
  if (raw.includes(0) || !isUtf8(raw)) return null;
  const current = raw.toString("utf8");
  const hits = current.split(args.old_string).length - 1;
  const expected = Math.max(1, Number(args.expected_replacements) || 1);
  if (hits !== expected) throw new Error("Patch match count " + hits + ", expected " + expected);
  const result = current.replaceAll(args.old_string, args.new_string);
  if (Buffer.byteLength(result) > MAX_TEXT_BYTES) throw new Error("Patched text exceeds limit");
  replaceAtomic(file, result);
  return { ok: true, path: file, output: "Replaced " + hits + " exact match(es)" };
}
