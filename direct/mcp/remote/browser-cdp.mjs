import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

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
        async call(method, params = {}, timeoutMs = 10000) {
          const id = seq++;
          return new Promise((res, rej) => {
            const t = setTimeout(() => {
              pending.delete(id);
              rej(new Error(`CDP timeout: ${method}`));
            }, timeoutMs);
            pending.set(id, { res, rej, t });
            ws.send(JSON.stringify({ id, method, params }));
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
  try { session.page?.close(); } catch {}
  if (session.child) await closeBrowser(session.child, session.browserWsUrl);
  try { fs.rmSync(session.runDir, { recursive: true, force: true }); } catch {}
}
async function createSession({root,browserBin,width,height}) {
  const runsRoot = path.join(root, "work", "bridge", "browser-runs");
  fs.mkdirSync(runsRoot,{recursive:true});
  const runDir=fs.mkdtempSync(path.join(runsRoot,"run-"));
  const profile=path.join(runDir,"profile");
  fs.mkdirSync(profile,{recursive:true});
  let child=null,page=null,browserWsUrl=null,stderr="";
  try {
    child=spawn(browserBin, [
      "--headless=new","--disable-gpu","--hide-scrollbars","--no-first-run",
      "--disable-first-run-ui","--disable-background-networking","--disable-component-update",
      "--window-size="+width+","+height,"--user-data-dir="+profile,
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
    return {root,runDir,child,page,browserWsUrl,port,version,stderr,idleTimer:null,inflight:0,tail:Promise.resolve(),healthy:true};
  } catch(error) {
    if(page)page.close();
    if(child)await closeBrowser(child,browserWsUrl);
    fs.rmSync(runDir,{recursive:true,force:true});
    throw error;
  }
}
async function withBrowser({root,browserBin,url,width=1440,height=1000,reuseSession=false},fn){
  if(!reuseSession){
    const once=await createSession({root,browserBin,width,height});
    try{return await fn(once.page,{port:once.port,version:once.version,stderr:once.stderr})}
    finally{await destroySession(once)}
  }
  const origin=new URL(url).origin;
  const key=JSON.stringify([root,browserBin,origin,width,height]);
  let slot=browserSessions.get(key);
  if(!slot){
    slot={session:null,pending:null};
    slot.pending=createSession({root,browserBin,width,height}).then(session=>{slot.session=session;return session});
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

export async function browserClick({ root, browserBin, url, selector, waitMs = 5000, reuseSession = false, verifiedFast = false }) {
  return withBrowser({ root, browserBin, url, reuseSession }, async page => {
    await navigate(page, url);
    await waitForSelector(page, selector, waitMs);
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
  return withBrowser({ root, browserBin, url, reuseSession }, async page => {
    await navigate(page, url);
    await waitForSelector(page, selector, waitMs);
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
  return withBrowser({ root, browserBin, url, reuseSession }, async page => {
    await navigate(page, url);
    await waitForSelector(page, selector, waitMs);
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
