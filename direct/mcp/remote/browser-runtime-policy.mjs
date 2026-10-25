import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Browser state is opt-in and scoped by origin; never attach to a personal Edge profile.
 * Config may be set via environment or root/work/bridge/browser-config.json.
 */
function validBrowserOrigin(value) {
  if (typeof value !== "string") return false;
  try { const u = new URL(value); return ["http:", "https:"].includes(u.protocol) && u.origin === value; }
  catch { return false; }
}

export function browserRuntimePolicy(root, url, env = process.env) {
  const settingsFile = path.join(root, "work", "bridge", "browser-config.json");
  let settings = {};
  if (fs.existsSync(settingsFile)) {
    settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    if (!settings || Array.isArray(settings) || typeof settings !== "object") {
      throw new Error("Browser config must be a JSON object");
    }
  }
  const origin = new URL(url).origin;
  const requestedMode = env.MOUSE_HOLE_BROWSER_PROFILE_MODE || settings.profileMode || "ephemeral";
  if (settings.persistOrigins !== undefined && (!Array.isArray(settings.persistOrigins) ||
      settings.persistOrigins.some(x => !validBrowserOrigin(x)))) {
    throw new Error("Browser persistOrigins must be an array of HTTP(S) origins");
  }
  if (settings.attachOrigins !== undefined && (!Array.isArray(settings.attachOrigins) ||
      settings.attachOrigins.some(x => !validBrowserOrigin(x)))) {
    throw new Error("Browser attachOrigins must be an array of HTTP(S) origins");
  }
  // Reuse the user's running Edge context, not a copied cookie jar. Explicit global opt-in.
  if (settings.edgeSessionReuse !== undefined && !["off","all"].includes(settings.edgeSessionReuse)) {
    throw new Error("edgeSessionReuse must be off or all");
  }
  const address = new URL(url);
  const localHost = ["localhost","127.0.0.1","[::1]"].includes(address.hostname);
  const trustedLocal = settings.edgeSessionIncludeLocalhost === true;
  const shareEdge = settings.edgeSessionReuse === "all" && (address.protocol === "https:" || (trustedLocal && localHost && address.protocol === "http:")) && (!localHost || trustedLocal);
  if (address.username || address.password) throw new Error("Embedded URL credentials are not supported");
  if (settings.sharedActionOrigins !== undefined && (!Array.isArray(settings.sharedActionOrigins) ||
      settings.sharedActionOrigins.some(x=>!validBrowserOrigin(x)))) {
    throw new Error("sharedActionOrigins must be a list of valid origins");
  }
  const allowSharedActions = Array.isArray(settings.sharedActionOrigins) && settings.sharedActionOrigins.includes(origin);
  const attach = shareEdge || (Array.isArray(settings.attachOrigins) && settings.attachOrigins.includes(origin));
  if (settings.automationOrigins !== undefined && (!Array.isArray(settings.automationOrigins) || settings.automationOrigins.some(x=>!validBrowserOrigin(x)))) {
    throw new Error("automationOrigins must contain valid site origins");
  }
  if (settings.actionOrigins !== undefined && (!Array.isArray(settings.actionOrigins) || settings.actionOrigins.some(x=>!validBrowserOrigin(x)))) {
    throw new Error("actionOrigins must contain valid site origins");
  }
  const automationSelected = Array.isArray(settings.automationOrigins) && settings.automationOrigins.includes(origin);
  const automation = automationSelected && (address.protocol === "https:" || (localHost && settings.automationIncludeLocalhost === true));
  if (automationSelected && !automation) throw new Error("Automated persistent sites require HTTPS");
  let attachPort = null;
  if (attach) {
    if (settings.attachPort === "auto") {
      // Only the debugger's port-discovery file is read; never inspect browser cookies or tokens.
      const portFile = env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA,"Microsoft","Edge","User Data","DevToolsActivePort") : null;
      if (portFile && fs.existsSync(portFile)) {
        const first = fs.readFileSync(portFile,"utf8").split(String.fromCharCode(10))[0].trim();
        const port = Number(first);
        if (Number.isSafeInteger(port) && port >= 1024 && port <= 65535) attachPort = port;
      }
    } else {
      const port = Number(settings.attachPort);
      if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
        throw new Error("Browser attach requires an explicit local CDP port or auto discovery");
      }
      attachPort = port;
    }
  }
  const mode = shareEdge ? "shared" : attach ? "attached" : automation ? "automation" :
    settings.persistOrigins && !settings.persistOrigins.includes(origin) ? "ephemeral" : requestedMode;
  const proxyMode = env.MOUSE_HOLE_BROWSER_PROXY_MODE || settings.proxyMode || "system";
  if (!["ephemeral", "persistent", "attached", "shared", "automation"].includes(mode)) throw new Error("Invalid browser profile mode");
  if (!["system", "manual"].includes(proxyMode)) throw new Error("Invalid browser proxy mode");
  let proxyServer = null;
  if (proxyMode === "manual") {
    const raw = env.MOUSE_HOLE_BROWSER_PROXY_SERVER || settings.proxyServer;
    if (typeof raw !== "string") throw new Error("Manual proxy mode requires a local proxy server");
    let u;
    try { u = new URL(raw); } catch { throw new Error("Invalid browser proxy URL"); }
    if (!["http:", "https:"].includes(u.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) ||
        u.username || u.password || u.pathname !== "/" || u.search || u.hash) {
      throw new Error("Browser proxy must be a local HTTP(S) endpoint without credentials");
    }
    proxyServer = u.origin;
  }
  if (!["http:", "https:"].includes(new URL(url).protocol)) throw new Error("Browser URL must use HTTP(S)");
  const key = crypto.createHash("sha256").update(origin).digest("hex").slice(0, 24);
  // Login state belongs in the current user's OS-private application data, not the project tree.
  const profileBase = process.platform === "win32" && env.LOCALAPPDATA
    ? path.join(env.LOCALAPPDATA, "MiceHole", "BrowserProfiles")
    : path.join(root, "work", "bridge", "browser-profiles");
  const autoBase = process.platform === "win32" && env.LOCALAPPDATA
    ? path.join(env.LOCALAPPDATA, "MiceHole", "MiceHole-Auto")
    : path.join(root, "work", "bridge", "MiceHole-Auto");
  const effectiveBase = mode === "automation" ? autoBase : profileBase;
  const actionSelected = Array.isArray(settings.actionOrigins) && settings.actionOrigins.includes(origin);
  const actionGranted = actionSelected && (address.protocol === "https:" || (localHost && settings.actionIncludeLocalhost === true));
  if (actionSelected && !actionGranted) throw new Error("Site action grants require HTTPS");
  return Object.freeze({ mode, attachPort, allowSharedActions:false, actionGranted, proxyMode, proxyServer, origin,
    profileBase:effectiveBase, profileDir:path.join(effectiveBase, "origin-" + key) });
}

function reclaimDeadBrowserLock(lockPath) {
  let owner;
  try { owner = JSON.parse(fs.readFileSync(lockPath, "utf8")); } catch { return false; }
  if (!Number.isSafeInteger(owner?.pid) || owner.pid <= 0) return false;
  try { process.kill(owner.pid, 0); return false; }
  catch (error) { if (error?.code !== "ESRCH") return false; }
  const stale = lockPath + ".stale-" + process.pid + "-" + crypto.randomBytes(4).toString("hex");
  try { fs.renameSync(lockPath, stale); fs.unlinkSync(stale); return true; }
  catch { return false; }
}

/**
 * A browser profile is not an authorization to mutate websites.
 * Read access is independent from site-scoped action permission.
 */
export function assertBrowserActionAllowed(root, url) {
  const p=browserRuntimePolicy(root,url);
  const u=new URL(url);
  const host=u.hostname.toLowerCase();
  const sensitiveHost = /(^|\.)(paypal\.com|stripe\.com|appleid\.apple\.com|id\.apple\.com|icloud\.com|account\.microsoft\.com|login\.microsoftonline\.com|outlook\.live\.com|outlook\.office\.com|accounts\.google\.com|myaccount\.google\.com|mail\.google\.com|drive\.google\.com|edu\.cn)$/i.test(host) || /(^|[.-])(bank|wallet|payment|payments)([.-]|$)/i.test(host);
  const sensitivePath = /(?:^|\/)(?:settings\/security|security|billing|checkout|payment|payments|delete|remove-account|password|two-factor|2fa|mfa|credentials|api-keys|tokens|ssh-keys)(?:\/|$)/i.test(u.pathname);
  if (p.mode === "shared" || p.mode === "attached") {
    throw new Error("Personal Edge connection is read-only; use the isolated automation profile");
  }
  if (sensitiveHost || sensitivePath) throw new Error("Sensitive website action requires separate human workflow");
  if (!p.actionGranted) throw new Error("Read-only browser policy: this site has no action permission");
  return p;
}

export function acquireBrowserProfile(policy, retryStale = true) {
  if (!["persistent", "automation"].includes(policy.mode)) return null;
  fs.mkdirSync(policy.profileBase, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(policy.profileBase).isSymbolicLink()) throw new Error("Browser profile root must not be a symlink");
  if (fs.existsSync(policy.profileDir) && fs.lstatSync(policy.profileDir).isSymbolicLink()) {
    throw new Error("Browser profile must not be a symlink");
  }
  const lockPath = policy.profileDir + ".lock";
  let fd;
  try {
    fd = fs.openSync(lockPath, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    fs.closeSync(fd);
    fd = null;
    fs.mkdirSync(policy.profileDir, { recursive: true, mode: 0o700 });
  } catch (error) {
    if (fd !== undefined && fd !== null) { try { fs.closeSync(fd); } catch {} }
    if (error?.code === "EEXIST") {
      if (retryStale && reclaimDeadBrowserLock(lockPath)) return acquireBrowserProfile(policy, false);
      throw new Error("Browser profile in use; refusing concurrent access");
    }
    if (fs.existsSync(lockPath)) {
      try {
        const owner = JSON.parse(fs.readFileSync(lockPath, "utf8"));
        if (owner.pid === process.pid) fs.unlinkSync(lockPath);
      } catch {}
    }
    throw error;
  }
  return { profileDir: policy.profileDir, release() { try { fs.unlinkSync(lockPath); } catch {} } };
}
