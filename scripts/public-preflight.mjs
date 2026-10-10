import fs from "node:fs";
import {spawnSync} from "node:child_process";
const res=spawnSync("git",["ls-files","-z"],{encoding:"utf8"});
if(res.status!==0)throw Error("Not a Git repository");
const files=res.stdout.split("\0").filter(Boolean);
const sensitivePaths=/(?:^|\/)(?:\.env(?:\..+)?|\.ssh|\.aws|\.azure|secrets?|credentials?|config\.json|\.pem|\.key)(?:\/|$)/i;
const secretContents=[
  /gh[opusr]_[A-Za-z0-9]{16,}/,
  /sk-[A-Za-z0-9_-]{20,}/,
  /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,
  /CONTROL_PLANE_API_KEY\s*=\s*[^\s"'$]+/i,
  /E:\\CHATGPT\\/i,
  /C:\\Users\\ndshuge\\/i,
];
let errors=[];let totalBytes=0;
for(const file of files){
  if(sensitivePaths.test(file))errors.push("Suspicious path: "+file);
  const stat=fs.statSync(file);totalBytes+=stat.size;
  if(stat.size>10*1024*1024) errors.push("Large tracked file: "+file);
  if(!/\.(?:md|mjs|ps1|cmd|iss|json|yml|yaml|txt|gitignore|vbs|cs)$/i.test(file)&&!file.startsWith(".git")&&file!=="LICENSE")errors.push("Review binary file: "+file);
  if(stat.size<2*1024*1024 && file!=="scripts/public-preflight.mjs"){
    const data=fs.readFileSync(file,"utf8");
    for(const pattern of secretContents)if(pattern.test(data))errors.push("Sensitive pattern "+pattern.source+" in "+file);
  }
}
console.log(JSON.stringify({ok:errors.length===0,files:files.length,total_bytes:totalBytes,errors},null,2));
if(errors.length)process.exitCode=1;
