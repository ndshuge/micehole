// Background-first GUI policy. No new agent, daemon or MCP tool.
const foregroundAllowed = env => String(env.MOUSE_HOLE_GUI_FOREGROUND_MODE || "").trim().toLowerCase() === "allow";

export function assertGuiPolicy(args, env = process.env) {
  const op = String(args?.operation || "");
  if (op === "status" || op === "wait") return "passive";
  if (args?.foreground_control !== true) {
    throw new Error("foreground_control=true is required for GUI actuation");
  }
  // Win32/WinForms BM_CLICK targets a specific native button without using global input.
  const semantic = op === "click" && typeof args.text === "string" && args.text.trim().length > 0;
  if (semantic) return "semantic_background";
  if (!foregroundAllowed(env)) {
    throw new Error("Foreground GUI is disabled by default (background-first). Explicitly opt in with MOUSE_HOLE_GUI_FOREGROUND_MODE=allow when not using the computer; never steal user input.");
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
  if (!foregroundAllowed(env)) {
    throw new Error("Foreground browser fallback is disabled by default (background-first). Set MOUSE_HOLE_GUI_FOREGROUND_MODE=allow explicitly to opt in.");
  }
}

export function isQuadrantEnabled(env = process.env) {
  return String(env.MOUSE_HOLE_GUI_LAYOUT || "").trim().toLowerCase() === "quadrant";
}
