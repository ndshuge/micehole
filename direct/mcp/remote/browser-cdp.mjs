import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { browserRuntimePolicy, acquireBrowserProfile, assertBrowserActionAllowed } from "./browser-runtime-policy.mjs";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function wsClient(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    let seq = 1;
    const timer = setTimeout(() => reject(new Error("CDP websocket open timeout")), 10000);

    ws.onopen = () => {
      clearTimeout(timer);
      resolve({
        async call(method, params = {}, timeoutMs = 10000, sessionId = null) {
          const id = seq++;
          return new Promise((res, rej) => {
            const t = setTimeout(() => {
              pending.delete(id);
              rej(new Error(`CDP timeout: ${method}`));
            }, timeoutMs);
            pending.set(id, { res, rej, t });
            ws.send(JSON.stringify({ id, method, params, ...(sessionId ? {sessionId} : {}) }));
          });
        },
        close() {
          try { ws.close(); } catch {}
        },
      });
    };
    ws.onerror = event => reject(new Error("CDP websocket error: " + String(event?.message || "unknown")));
    ws.onmessage = event => {
      let msg;
      try { msg = JSON.parse(String(event.data)); } catch { return; }
      if (!msg.id || !pending.has(msg.id)) return;
      const waiter = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(waiter.t);
      if (msg.error) waiter.rej(new Error(msg.error.message || JSON.stringify(msg.error)));
      else waiter.res(msg.result || {});
    };
    ws.onclose = () => {
      for (const waiter of pending.values()) {
        clearTimeout(waiter.t);
        waiter.rej(new Error("CDP websocket closed"));
      }
      pending.clear();
    };
  });
}

async function waitForActivePort(profile, child, timeoutMs = 12000) {
  const file = path.join(profile, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Headless browser exited before CDP became ready");
    if (fs.existsSync(file)) {
      let raw;
      try { raw = fs.readFileSync(file, "utf8"); }
      catch (error) {
        if (["EBUSY", "EACCES", "EPERM"].includes(error?.code)) { await sleep(90); continue; }
        throw error;
      }
      const lines = raw.trim().split(/\r?\n/);
      const port = Number(lines[0]);
      if (Number.isInteger(port) && port > 0) return port;
    }
    await sleep(100);
  }
  throw new Error("Headless browser CDP startup timeout");
}

async function closeBrowser(child, browserWsUrl) {
  try {
    if (browserWsUrl) {
      const browser = await wsClient(browserWsUrl);
      try { await browser.call("Browser.close", {}, 3000); } catch {}
      browser.close();
    }
  } catch {}
  const deadline = Date.now() + 2500;
  while (child.exitCode === null && Date.now() < deadline) await sleep(50);
  if (child.exitCode === null) {
    try { child.kill(); } catch {}
  }
}


// One session per origin and viewport, serialized locally. No second reasoning agent.
const browserSessions = new Map();
const BROWSER_IDLE_MS = Math.max(1000, Number(process.env.MOUSE_HOLE_BROWSER_IDLE_MS || 30000));
process.once("exit", () => {
  for (const pending of browserSessions.values()) {
    // Exit handlers cannot await. Kill only processes this Runtime itself created.
    if (pending.session) try { pending.session.child.kill(); } catch {}
  }
});
async function destroySession(session) {
  clearTimeout(session.idleTimer);
  if (session.attached || session.shared) {
    // Never export cookies, close the external browser, or touch the user's original tab.
    try { session.page?.close(); } catch {}
    if (session.shared) {
      try {
        const closed=await session.browser.call("Target.closeTarget",{targetId:session.targetId},3000);
        if (closed.success!==true) throw new Error("Owned hidden Edge target could not be closed");
      } finally {session.browser.close();}
    }
    return;
  }
  try {
    try { await session.page?.call("Network.flushBrowserCookies", {}, 3000); } catch {}
    try { session.page?.close(); } catch {}
    if (session.child) await closeBrowser(session.child, session.browserWsUrl);
  } finally {
    try { fs.rmSync(session.runDir, { recursive: true, force: true }); } catch {}
    session.profileLock?.release();
  }
}
export async function browserAttachedStatus(root, url) {
  const policy = browserRuntimePolicy(root, url);
  if (!["attached","shared"].includes(policy.mode)) return {mode:policy.mode,ready:false,reason:"not_configured"};
  if (!policy.attachPort) return {mode:policy.mode,ready:false,reason:"edge_debugging_not_enabled"};
  try {
    const endpoint = "http://127.0.0.1:" + policy.attachPort;
    const response = await fetch(endpoint + "/json/version",{signal:AbortSignal.timeout(2000)});
    if (!response.ok) return {mode:"attached",ready:false,reason:"cdp_unavailable"};
    const version = await response.json();
    if (!String(version.Browser || "").startsWith("Edg/")) return {mode:"attached",ready:false,reason:"not_edge"};
    const pagesResp = await fetch(endpoint + "/json/list",{signal:AbortSignal.timeout(2000)});
    if (!pagesResp.ok) return {mode:"attached",ready:false,reason:"cdp_unavailable"};
    const targets = await pagesResp.json();
    if (policy.mode === "shared") return {mode:"shared",ready:true,reason:"ready"};
    const matches = targets.filter(t=>t.type==="page" && t.url===url);
    return {mode:"attached",ready:matches.length===1,reason:matches.length===1?"ready":"matching_tab_missing_or_ambiguous"};
  } catch {return {mode:"attached",ready:false,reason:"cdp_unavailable"};}
}

async function createAttachedSession({policy,url}) {
  // Explicit opt-in: connect only to an already open Edge tab at the exact URL.
  const port = policy.attachPort;
  if (!port) throw new Error("Edge debugging not enabled or its local port is unavailable");
  const base = "http://127.0.0.1:" + port;
  const fetchLocal = async suffix => {
    const response = await fetch(base + suffix, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error("Local Edge CDP endpoint unavailable");
    return response.json();
  };
  const version = await fetchLocal("/json/version");
  if (!String(version.Browser || "").startsWith("Edg/")) throw new Error("Attached CDP endpoint is not Microsoft Edge");
  const targets = await fetchLocal("/json/list");
  const matches = targets.filter(t => t.type === "page" && t.url === url && t.webSocketDebuggerUrl);
  if (matches.length !== 1) throw new Error("Expected exactly one open Edge tab matching the requested URL; no tab was changed");
  const targetWs = new URL(matches[0].webSocketDebuggerUrl);
  if (targetWs.protocol !== "ws:" || !["127.0.0.1", "localhost"].includes(targetWs.hostname) ||
      Number(targetWs.port) !== port || !targetWs.pathname.startsWith("/devtools/page/")) {
    throw new Error("Unsafe Edge CDP page endpoint");
  }
  const page = await wsClient(targetWs.href);
  try {
    await page.call("Runtime.enable");
    // A guard in navigate() prevents moving an existing user tab to another URL.
    page.__miceAttached = true;
    page.__miceLastUrl = url;
    return { attached:true, attachedUrl:url, page, port, version, inflight:0,
      idleTimer:null, tail:Promise.resolve(), healthy:true };
  } catch (error) { page.close(); throw error; }
}

async function createSharedEdgeSession({policy,url}) {
  // Browser-context sharing: no cookie or token extraction. The user owns the Edge instance.
  const port=policy.attachPort;
  if (!port) throw new Error("Edge remote debugging must be enabled by the user before sharing its session");
  const base="http://127.0.0.1:"+port;
  const request=async suffix => {
    const response=await fetch(base+suffix,{signal:AbortSignal.timeout(3000)});
    if (!response.ok) throw new Error("Local Edge CDP unavailable");
    return response.json();
  };
  const version=await request("/json/version");
  if (!String(version.Browser||"").startsWith("Edg/")) throw new Error("CDP endpoint is not Microsoft Edge");
  const wsUrl=new URL(version.webSocketDebuggerUrl || "");
  if (wsUrl.protocol!=="ws:" || !["127.0.0.1","localhost"].includes(wsUrl.hostname) ||
      Number(wsUrl.port)!==port || !wsUrl.pathname.startsWith("/devtools/browser/")) {
    throw new Error("Unsafe browser debugger endpoint");
  }
  const browser=await wsClient(wsUrl.href);
  let page=null,targetId=null;
  try {
    // Hidden targets cannot steal focus; failure must NOT fall back to a visible tab.
    const created=await browser.call("Target.createTarget",
      {url:"about:blank",hidden:true,background:true},8000);
    targetId=created.targetId;
    if (!targetId) throw new Error("Edge did not return a hidden target");
    // Hidden targets are intentionally not listed on the public /json/list endpoint.
    // CDP's flattened target session can drive them entirely within the browser socket.
    const attached=await browser.call("Target.attachToTarget",{targetId,flatten:true},8000);
    if (!attached.sessionId) throw new Error("Hidden target did not grant a CDP session");
    const sessionId=attached.sessionId;
    page={call:(method,params={},timeoutMs=10000)=>browser.call(method,params,timeoutMs,sessionId),close:()=>{}};
    await page.call("Page.enable");
    await page.call("Runtime.enable");
    return {shared:true,attachedUrl:url,page,browser,targetId,port,version,
      idleTimer:null,inflight:0,tail:Promise.resolve(),healthy:true};
  } catch(error) {
    try {page?.close()}catch{}
    if(targetId) try {await browser.call("Target.closeTarget",{targetId},3000)}catch{}
    browser.close();
    throw error;
  }
}

async function createSession({root,browserBin,width,height,policy}) {
  const runsRoot = path.join(root, "work", "bridge", "browser-runs");
  fs.mkdirSync(runsRoot,{recursive:true});
  const runDir=fs.mkdtempSync(path.join(runsRoot,"run-"));
  const profile=["persistent","automation"].includes(policy.mode) ? policy.profileDir : path.join(runDir,"profile");
  let profileLock=null;
  let child=null,page=null,browserWsUrl=null,stderr="";
  try {
    profileLock=acquireBrowserProfile(policy);
    fs.mkdirSync(profile,{recursive:true,mode:0o700});
    if (profileLock) {
      try { fs.rmSync(path.join(profile,"DevToolsActivePort"), { force: true }); } catch {}
    }
    child=spawn(browserBin, [
      "--headless=new","--disable-gpu","--hide-scrollbars","--no-first-run",
      "--disable-first-run-ui","--disable-background-networking","--disable-component-update",
      "--window-size="+width+","+height,"--user-data-dir="+profile,
      ...(policy.proxyServer ? ["--proxy-server="+policy.proxyServer] : []),
      "--remote-debugging-port=0","about:blank"
    ],{windowsHide:true,stdio:["ignore","ignore","pipe"]});
    child.stderr.on("data",chunk=>{if(stderr.length<20000)stderr+=chunk.toString("utf8")});
    const port=await waitForActivePort(profile,child);
    const base="http://127.0.0.1:"+port;
    const version=await fetch(base+"/json/version").then(r=>{if(!r.ok)throw Error("CDP version request failed");return r.json()});
    browserWsUrl=version.webSocketDebuggerUrl;
    const targets=await fetch(base+"/json/list").then(r=>r.json());
    const target=targets.find(t=>t.type==="page");
    if(!target?.webSocketDebuggerUrl)throw Error("No CDP page target found");
    page=await wsClient(target.webSocketDebuggerUrl);
    await page.call("Page.enable");
    await page.call("Runtime.enable");
    await page.call("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:false});
    return {root,runDir,child,page,browserWsUrl,port,version,stderr,profileLock,idleTimer:null,inflight:0,tail:Promise.resolve(),healthy:true};
  } catch(error) {
    try {
      if(page)page.close();
      if(child)await closeBrowser(child,browserWsUrl);
    } finally {
      fs.rmSync(runDir,{recursive:true,force:true});
      profileLock?.release();
    }
    throw error;
  }
}
async function withBrowser({root,browserBin,url,width=1440,height=1000,reuseSession=false},fn){
  const policy=browserRuntimePolicy(root,url);
  const start = () => policy.mode === "attached" ? createAttachedSession({policy,url}) :
    policy.mode === "shared" ? createSharedEdgeSession({policy,url}) :
    createSession({root,browserBin,width,height,policy});
  if(!reuseSession){
    const once=await start();
    try{return await fn(once.page,{port:once.port,version:once.version,stderr:once.stderr})}
    finally{await destroySession(once)}
  }
  const key=JSON.stringify([root,browserBin,policy.origin,policy.mode,policy.attachPort,policy.proxyMode,policy.proxyServer,
    ...(policy.mode === "attached" ? [url] : ["persistent","automation"].includes(policy.mode) ? [] : [width,height])]);
  let slot=browserSessions.get(key);
  if(!slot){
    slot={session:null,pending:null};
    slot.pending=start().then(session=>{slot.session=session;return session});
    browserSessions.set(key,slot);
    slot.pending.catch(()=>{if(browserSessions.get(key)===slot)browserSessions.delete(key)});
  }
  const session=await slot.pending;
  clearTimeout(session.idleTimer);
  session.inflight++;
  const previous=session.tail;
  let release;
  session.tail=new Promise(resolve=>release=resolve);
  await previous;
  try{
    if(!session.healthy)throw Error("Browser session invalidated; retry");
    if (["persistent","automation"].includes(policy.mode)) {
      await session.page.call("Emulation.setDeviceMetricsOverride", {width,height,deviceScaleFactor:1,mobile:false});
    }
    return await fn(session.page,{port:session.port,version:session.version,stderr:session.stderr});
  } catch(error){
    session.healthy=false;
    throw error;
  } finally {
    release();
    session.inflight--;
    if(session.inflight===0){
      const expire=async()=> {
        if(browserSessions.get(key)===slot)browserSessions.delete(key);
        await destroySession(session).catch(()=>{});
      };
      if(!session.healthy)void expire();
      else {
        session.idleTimer=setTimeout(()=>{void expire()},BROWSER_IDLE_MS);
        session.idleTimer.unref?.();
      }
    }
  }
}

// Explicit lifecycle close for bounded one-shot stages; Runtime's usual idle reuse remains unchanged.
export async function closeBrowserSessions() {
  const slots=[...browserSessions.values()];
  browserSessions.clear();
  await Promise.allSettled(slots.map(async slot=>{
    const session=await slot.pending;
    clearTimeout(session.idleTimer);
    await destroySession(session);
  }));
}

async function navigate(page, url) {
  if (page.__miceAttached) {
    // A target may be enumerated before its execution context is ready.
    for (let attempt = 0; attempt < 15; attempt++) {
      const current = await page.call("Runtime.evaluate", { expression:"location.href", returnByValue:true });
      if (current.result?.value === url) return;
      await sleep(100);
    }
    throw new Error("Attached Edge tab changed or its page is unavailable; navigation refused");
  }
  if (page.__miceLastUrl === url) {
    const check = await page.call("Runtime.evaluate", { expression: "({href: location.href, ready: document.readyState})", returnByValue: true });
    if (check.result?.value?.href === url && ["complete","interactive"].includes(check.result.value.ready)) return;
  }
  const nav = await page.call("Page.navigate", { url }, 10000);
  if (nav.errorText) throw new Error("Navigation failed: " + nav.errorText);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const ready = await page.call("Runtime.evaluate", {
      expression: "document.readyState",
      returnByValue: true,
    });
    const value = ready.result?.value;
    if (value === "complete" || value === "interactive") {
      page.__miceLastUrl = url;
      await sleep(150);
      return;
    }
    await sleep(100);
  }
  throw new Error("Navigation readiness timeout");
}

export async function browserDumpDom({ root, browserBin, url, maxChars = 30000, reuseSession = false }) {
  return withBrowser({ root, browserBin, url, reuseSession }, async page => {
    await navigate(page, url);
    const result = await page.call("Runtime.evaluate", {
      expression: "document.documentElement.outerHTML",
      returnByValue: true,
    });
    const dom = String(result.result?.value || "");
    return {
      dom: dom.slice(0, maxChars),
      truncated: dom.length > maxChars,
      total_chars: dom.length,
    };
  });
}


function selectorLiteral(selector) {
  if (!selector || typeof selector !== "string") throw new Error("selector is required");
  return JSON.stringify(selector);
}

async function waitForSelector(page, selector, timeoutMs = 5000) {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  const literal = selectorLiteral(selector);
  while (Date.now() <= deadline) {
    const result = await page.call("Runtime.evaluate", {
      expression: `Boolean(document.querySelector(${literal}))`,
      returnByValue: true,
    });
    if (result.result?.value === true) return;
    await sleep(100);
  }
  throw new Error(`Selector not found: ${selector}`);
}

async function inspectSelector(page, selector) {
  const literal = selectorLiteral(selector);
  const result = await page.call("Runtime.evaluate", {
    expression: `(() => {
      const el = document.querySelector(${literal});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        text: String(el.innerText ?? el.textContent ?? "").slice(0, 4000),
        value: "value" in el ? String(el.value ?? "").slice(0, 4000) : null,
        type: el.getAttribute?.("type") || null,
        disabled: Boolean(el.disabled),
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      };
    })()`,
    returnByValue: true,
  });
  return result.result?.value ?? null;
}

export async function browserInspect({ root, browserBin, url, selector, waitMs = 5000, reuseSession = false }) {
  return withBrowser({ root, browserBin, url, reuseSession }, async page => {
    await navigate(page, url);
    await waitForSelector(page, selector, waitMs);
    return { selector, element: await inspectSelector(page, selector) };
  });
}

async function assertNonSensitiveElement(page, selector) {
  const literal=JSON.stringify(selector);
  const result=await page.call("Runtime.evaluate",{
    expression:`(() => {
      const el=document.querySelector(${literal});
      if(!el) return false;
      const semantics=[el.getAttribute("aria-label"),el.getAttribute("title"),el.id,el.getAttribute("name"),
        (el.innerText || "").slice(0,120),el.closest("form")?.getAttribute("action"),el.getAttribute("href")].join(" ").toLowerCase();
      const danger=/(?:delete|remove.account|transfer|pay.now|purchase|buy.now|checkout|security|billing|password|passkey|api.key|secret|two.factor|2fa|mfa|terminate|erase|revoke|unsubscribe)/i;
      return !danger.test(semantics) && !["password","hidden"].includes(el.type) &&
        !["submit"].includes((el.getAttribute("type")||"").toLowerCase());
    })()`,
    returnByValue:true
  });
  if(result.result?.value!==true) throw new Error("Sensitive or ambiguous browser control blocked");
}

export async function browserClick({ root, browserBin, url, selector, waitMs = 5000, reuseSession = false, verifiedFast = false }) {
  assertBrowserActionAllowed(root,url);
  return withBrowser({ root, browserBin, url, reuseSession }, async page => {
    await navigate(page, url);
    await waitForSelector(page, selector, waitMs);
    await assertNonSensitiveElement(page, selector);
    const literal = selectorLiteral(selector);
    await page.call("Runtime.evaluate", {
      expression: `(() => { const el = document.querySelector(${literal}); el.scrollIntoView({block:"center",inline:"center"}); el.click(); return true; })()`,
      returnByValue: true,
    });
    if (!verifiedFast) await sleep(100);
    return { selector, element: await inspectSelector(page, selector) };
  });
}

export async function browserFill({ root, browserBin, url, selector, text, waitMs = 5000, reuseSession = false, verifiedFast = false }) {
  assertBrowserActionAllowed(root,url);
  return withBrowser({ root, browserBin, url, reuseSession }, async page => {
    await navigate(page, url);
    await waitForSelector(page, selector, waitMs);
    await assertNonSensitiveElement(page, selector);
    const literal = selectorLiteral(selector);
    const value = JSON.stringify(String(text ?? ""));
    await page.call("Runtime.evaluate", {
      expression: `(() => {
        const el = document.querySelector(${literal});
        el.focus();
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, "value");
        if (desc?.set) desc.set.call(el, ${value}); else el.value = ${value};
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()`,
      returnByValue: true,
    });
    if (!verifiedFast) await sleep(50);
    return { selector, element: await inspectSelector(page, selector) };
  });
}

export async function browserType({ root, browserBin, url, selector, text, waitMs = 5000, reuseSession = false }) {
  assertBrowserActionAllowed(root,url);
  return withBrowser({ root, browserBin, url, reuseSession }, async page => {
    await navigate(page, url);
    await waitForSelector(page, selector, waitMs);
    await assertNonSensitiveElement(page, selector);
    const literal = selectorLiteral(selector);
    await page.call("Runtime.evaluate", {
      expression: `(() => { const el = document.querySelector(${literal}); el.focus(); return true; })()`,
      returnByValue: true,
    });
    await page.call("Input.insertText", { text: String(text ?? "") });
    await sleep(50);
    return { selector, element: await inspectSelector(page, selector) };
  });
}

export async function browserScreenshot({ root, browserBin, url, outputPath, width = 1440, height = 1000, reuseSession = false }) {
  return withBrowser({ root, browserBin, url, width, height, reuseSession }, async page => {
    await navigate(page, url);
    const shot = await page.call("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    }, 15000);
    if (!shot.data) throw new Error("CDP screenshot returned no data");
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, Buffer.from(shot.data, "base64"));
    return { outputPath, size: fs.statSync(outputPath).size };
  });
}
