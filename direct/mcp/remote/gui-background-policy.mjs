// Background-first GUI policy. No new agent, daemon or MCP tool.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const IDLE_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "gui-safety-probe.py");
const RELAXED_IDLE_MS = 900;
export function evaluateGuiSafety(data) {
  if (!data || !Number.isSafeInteger(data.idle_ms) || data.idle_ms < 0 ||
      typeof data.game_running !== "boolean" || typeof data.fullscreen_foreground !== "boolean" ||
      typeof data.block_foreground !== "boolean") {
    throw new Error("Invalid Windows GUI safety state; foreground operation deferred");
  }
  if (data.game_running || data.fullscreen_foreground || data.block_foreground) {
    throw new Error("Game or fullscreen window protected: foreground GUI operation deferred");
  }
  if (data.idle_ms < RELAXED_IDLE_MS) {
    throw new Error("User currently interacting; foreground GUI input deferred");
  }
  return "normal_gui_allowed";
}
function assertUserIdle(env = process.env) {
  const r = spawnSync(env.HANAKO_PYTHON || "python", ["-u", IDLE_SCRIPT], {
    encoding: "utf8", windowsHide: true, timeout: 4000, maxBuffer: 4096,
  });
  if (r.error || r.status !== 0) throw new Error("Cannot verify user idle; foreground operation deferred");
  let sample;
  try { sample = JSON.parse(r.stdout); } catch { throw new Error("Invalid Windows GUI safety report; foreground operation deferred"); }
  evaluateGuiSafety(sample);
}
const foregroundAllowed = env => String(env.MOUSE_HOLE_GUI_FOREGROUND_MODE || "").trim().toLowerCase() === "allow";

export function assertGuiPolicy(args, env = process.env) {
  const op = String(args?.operation || "");
  if (op === "status" || op === "wait") return "passive";
  if (args?.foreground_control !== true) {
    throw new Error("foreground_control=true is required for GUI actuation");
  }
  if (String(env.MOUSE_HOLE_GUI_GAME_LOCK || "").trim().toLowerCase() === "on") {
    throw new Error("Manual gaming lock active; no GUI actuation permitted");
  }
  // Win32/WinForms BM_CLICK targets a specific native button without using global input.
  const semantic = op === "click" && typeof args.text === "string" && args.text.trim().length > 0;
  if (semantic) {
    // Native button clicks can still open dialogs, so protect gaming sessions.
    assertUserIdle(env);
    return "semantic_background";
  }
  if (!foregroundAllowed(env)) {
    throw new Error("Foreground GUI is disabled by default (background-first). Explicitly opt in with MOUSE_HOLE_GUI_FOREGROUND_MODE=allow when not using the computer; never steal user input.");
  }
  if (op === "launch") {
    // Unlike foreground inputs, launcher runs without gui-windows.ps1. Never
    // create a popup or steal focus during a game/fullscreen session.
    assertUserIdle(env);
  }
  if (["type_text", "key_press", "hotkey"].includes(op) && !String(args.title || "").trim()) {
    throw new Error("Exact target window title is required for global keyboard actions");
  }
  return "foreground_opt_in";
}

export function assertBrowserForegroundPolicy(args, env = process.env) {
  if (args?.foreground_control !== true) {
    throw new Error("foreground_control=true is required for foreground browser fallback");
  }
  if (String(env.MOUSE_HOLE_GUI_GAME_LOCK || "").trim().toLowerCase() === "on") {
    throw new Error("Manual gaming lock active; no browser foreground launch permitted");
  }
  if (!foregroundAllowed(env)) {
    throw new Error("Foreground browser fallback is disabled by default (background-first). Set MOUSE_HOLE_GUI_FOREGROUND_MODE=allow explicitly to opt in.");
  }
  // Browser foreground launch has no gui-windows.ps1 guard; enforce it here as well.
  assertUserIdle(env);
}

export function isQuadrantEnabled(env = process.env) {
  // Default quarter-screen placement for newly launched Agent-owned windows.
  // Only an explicit 'off' disables it; foreground input still needs opt-in.
  return String(env.MOUSE_HOLE_GUI_LAYOUT || "").trim().toLowerCase() !== "off";
}
