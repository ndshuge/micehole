// Experimental LOCAL-ONLY worker transport. It is deliberately NOT an OS security boundary.
// The child and broker can share a Windows SID in this fixture. Never attach this to Tunnel.
import net from "node:net";
import { timingSafeEqual } from "node:crypto";

const MAX_FRAME = 8192;
const MAX_TEXT = 512;
function send(socket, payload) {
  const encoded = JSON.stringify(payload);
  if (Buffer.byteLength(encoded, "utf8") > MAX_FRAME) throw Error("Response exceeds fixture size");
  socket.write(encoded + "\n");
}
function validToken(given, expected) {
  if (typeof given !== "string" || typeof expected !== "string") return false;
  const a = Buffer.from(given, "utf8"), b = Buffer.from(expected, "utf8");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
function exactKeys(obj, allowed) {
  return obj && typeof obj === "object" && !Array.isArray(obj) &&
    Object.keys(obj).every(k => allowed.includes(k));
}
export function validateFixtureRequest(req) {
  if (!exactKeys(req, ["kind", "id", "op", "text", "attestation"])) throw Error("Invalid request shape");
  if (req.kind !== "request" || !Number.isSafeInteger(req.id) || req.id < 1) throw Error("Bad request ID");
  if (!["status", "echo", "execute", "git", "process", "validate"].includes(req.op)) throw Error("Unsupported operation");
  if (req.text !== undefined && (typeof req.text !== "string" || req.text.length > MAX_TEXT)) throw Error("Bad text");
  return req;
}
export function evaluateFixture(req) {
  validateFixtureRequest(req);
  if (req.op === "status") {
    const inheritedSensitiveKeys = Object.keys(process.env).filter(k => /(?:OPENAI|CONTROL_PLANE|AZURE_CLIENT_SECRET|MICEHOLE_RUNTIME_KEY|TEST_SECRET)/i.test(k));
    return {
      kind: "result", id: req.id, ok: true, operation: "status",
      fixture_only: true, separate_windows_sid_verified: false,
      ipc_peer_sid_authenticated: false, os_acl_verified: false,
      remote_exec_enabled: false, inherited_sensitive_keys: inheritedSensitiveKeys,
    };
  }
  if (req.op === "echo") return {kind: "result", id: req.id, ok: true, text: req.text ?? ""};
  // No executable backend: even forged authorization, SID and attestation fields cannot unlock it.
  return {kind: "result", id: req.id, ok: false, error: "WORKER_NOT_OS_ISOLATED"};
}
export async function startFixtureServer({pipe, token}) {
  if (!pipe || typeof pipe !== "string" || pipe.length > 250 || !token || token.length < 32)
    throw Error("Fixture requires a unique local pipe and a random temporary token");
  const server = net.createServer(socket => {
    socket.setTimeout(4000, () => socket.destroy());
    let authenticated = false, buffer = "";
    socket.on("data", chunk => {
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer, "utf8") > MAX_FRAME * 2) {
        send(socket,{kind:"error",error:"FRAME_TOO_LARGE"});socket.destroy();return;
      }
      while (buffer.includes("\n")) {
        const ix = buffer.indexOf("\n"), frame = buffer.slice(0, ix);
        buffer = buffer.slice(ix + 1);
        if (Buffer.byteLength(frame, "utf8") > MAX_FRAME) {
          send(socket,{kind:"error",error:"FRAME_TOO_LARGE"});socket.end();break;
        }
        let msg;
        try { msg = JSON.parse(frame); } catch {send(socket,{kind:"error",error:"INVALID_JSON"});socket.end();break;}
        if (!authenticated) {
          if (msg?.kind !== "auth" || !exactKeys(msg, ["kind","token"]) || !validToken(msg.token,token)) {
            send(socket,{kind:"auth",ok:false,error:"UNAUTHORIZED_FIXTURE_PEER"});socket.end();break;
          }
          authenticated = true;
          send(socket,{kind:"auth",ok:true,version:1});
          continue;
        }
        try{send(socket,evaluateFixture(msg))}
        catch(e){send(socket,{kind:"error",id:msg?.id??null,error:String(e.message).slice(0,120)})}
      }
    });
    socket.on("error", () => {});
  });
  await new Promise((resolve,reject) => {
    server.once("error",reject);
    server.listen(pipe, () => {server.removeListener("error",reject);resolve()});
  });
  return server;
}
export async function requestFixture({pipe, token, request, timeoutMs=3500}) {
  return await new Promise((resolve, reject) => {
    let settled = false, buffer = "", stage = 0;
    const socket = net.createConnection(pipe);
    const timer = setTimeout(() => finish(new Error("WORKER_FIXTURE_TIMEOUT")), timeoutMs);
    function finish(error, result) {
      if(settled)return; settled=true;clearTimeout(timer);socket.destroy();
      error ? reject(error) : resolve(result);
    }
    socket.on("connect", () => send(socket,{kind:"auth",token}));
    socket.on("data", chunk => {
      buffer += chunk.toString("utf8");
      if(Buffer.byteLength(buffer,"utf8") > MAX_FRAME * 2){finish(Error("WORKER_RESPONSE_OVERSIZE"));return;}
      while(buffer.includes("\n")){
        const i = buffer.indexOf("\n"), raw=buffer.slice(0,i);buffer=buffer.slice(i+1);
        let message;
        try{message=JSON.parse(raw)}catch{return finish(Error("WORKER_BAD_JSON"))}
        if(stage===0){
          if(message.kind!=="auth" || message.ok!==true)return finish(Error("WORKER_AUTH_FAILED"));
          stage=1;send(socket,request);
        }else return finish(null,message);
      }
    });
    socket.on("error",finish);
    socket.on("close",()=>{if(!settled)finish(Error("WORKER_DISCONNECTED"))});
  });
}
