import {smartRead,closeSmartReadSessions} from "./hybrid-read.mjs";
const [intent="content",url,space="smart-read",prefer="auto"] = process.argv.slice(2);
try {
 const result=await smartRead({url,intent,space,prefer});
 console.log(JSON.stringify(result));
} catch(e) {
 console.error(JSON.stringify({ok:false,error:String(e.message||e)}));process.exitCode=1;
} finally {await closeSmartReadSessions()}
