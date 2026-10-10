// Deliberately harmless same-user transport fixture. No shell, Git, file writes or Tunnel.
import { startFixtureServer } from "../../src/worker/fixture-ipc.mjs";
const pipe=process.env.MICEHOLE_FIXTURE_PIPE;
const token=process.env.MICEHOLE_FIXTURE_TOKEN;
if(process.env.MICEHOLE_FIXTURE_ONLY !== "1" || !pipe || !token){
  console.error("Worker fixture is offline tests only");process.exit(2);
}
const server=await startFixtureServer({pipe,token});
process.stdout.write("MICEHOLE_FIXTURE_READY\n");
const shut=()=>server.close(()=>process.exit(0));
process.on("SIGTERM",shut);
process.on("SIGINT",shut);
