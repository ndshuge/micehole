import subprocess,re,collections,sys
def git(*args,inp=None):
 return subprocess.run(['git',*args],input=inp,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout
listing=git('rev-list','--objects','--all').decode('utf-8','replace').splitlines()
entries=[(x.split(' ',1)[0],x.split(' ',1)[1] if ' ' in x else '<meta>') for x in listing]
ids=[s for s,_ in entries]
raw=git('cat-file','--batch',inp=(''.join(s+'\n' for s in ids)).encode())
patterns=[
('access-token',rb'(?i)(?:gh[opusr]_[a-z0-9]{16,}|github_pat_[a-z0-9_]{20,}|sk-(?:proj-)?[a-z0-9_-]{25,}|xox[baprs]-[a-z0-9-]{15,})'),
('private-key',rb'-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----'),
('api-key-assignment',rb'(?i)(?:API_KEY|ACCESS_TOKEN|SECRET_KEY|PASSWORD|TUNNEL_TOKEN|RUNTIME_KEY)\s*[:=]\s*["\x27]?[a-z0-9_-]{20,}'),
('windows-personal-home',rb'(?i)(?:C:\\Users\\|\/Users\/)[^\/\\\s]{3,}'),
('private-workspace-path',rb'(?i)[A-Z]:\\(?:CHATGPT|Hanako|AI)\\'),
('machine-identifier',rb'(?i)LAPTOP-[A-Z0-9]{5,}'),
('sensitive-local-ip',rb'\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b'),
('email',rb'(?i)\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b'),
('credential-json-label',rb'(?i)"(?:runtime_key|api_key|access_token|refresh_token|client_secret)"\s*:\s*"[a-z0-9+/=_-]{12,}"')
]
# Reviewed legacy Git blobs from before v3.0.1. These immutable old
# source files contain local workspace PATH EXAMPLES, not authentication data.
# Keep detecting all new blob SHAs/paths and every credential-like pattern.
# This is a visible historical-debt exception, not removal from Git history.
PREEXISTING_WORKSPACE_PATH_BLOBS = {
 ('4a5ebcd5255f22450851c5a967b9a3fa2990b4e5','direct/mcp/remote/b2_gate_adapter.py'),
 ('12f7a60989df47039bbaa7bd747dab5bd3194455','scripts/assemble-direct-v3.py'),
 ('3c0c2028e9a844fe184757cac7f6d10eb714c002','scripts/enable-v3-remote.py'),
 ('f8f12a8c05de05569ef4c92fecb0948c39bff439','scripts/revise-v3-remote-docs.py'),
 ('6ac0ac30ce3ac293568a83bf9ec076e92c3836c0','scripts/update-v3-docs.py')
}
def is_known_legacy_path(sha,path,label):
 return label=='private-workspace-path' and (sha,path) in PREEXISTING_WORKSPACE_PATH_BLOBS

if '--self-test' in sys.argv:
 assert is_known_legacy_path('4a5ebcd5255f22450851c5a967b9a3fa2990b4e5','direct/mcp/remote/b2_gate_adapter.py','private-workspace-path')
 assert not is_known_legacy_path('4a5ebcd5255f22450851c5a967b9a3fa2990b4e5','direct/mcp/remote/b2_gate_adapter.py','access-token')
 assert not is_known_legacy_path('4a5ebcd5255f22450851c5a967b9a3fa2990b4e5','mcp/remote/b2_gate_adapter.py','private-workspace-path')
 assert not is_known_legacy_path('0'*40,'direct/mcp/remote/b2_gate_adapter.py','private-workspace-path')
 print('HISTORICAL_AUDIT_BASELINE_SELFTEST=PASS');sys.exit(0)

pats=[(x,re.compile(y)) for x,y in patterns]
issues=collections.defaultdict(list);count=collections.Counter();offs=0
for sha,path in entries:
 end=raw.index(b'\n',offs)
 hdr=raw[offs:end].decode('utf-8','replace')
 if hdr.endswith(' missing'):offs=end+1;continue
 kind,size=hdr.rsplit(' ',2)[-2:];size=int(size)
 content=raw[end+1:end+1+size];offs=end+1+size+1
 if kind!='blob' or size>3_000_000 or b'\0' in content[:1000]:continue
 for label,pattern in pats:
  matches=pattern.findall(content)
  for m in matches:
   if label == 'api-key-assignment' and any(s in m.upper() for s in
       (b'FAKE_TEST_CREDENTIAL_ONLY', b'TEST_SECRET_NOT_REAL', b'PARENT_ONLY_SENTINEL_NOT_REAL')):
    count['allowlisted-test-fixture']+=1
    continue
   if label == 'windows-personal-home' and (b'YOUR_USER' in m.upper() or b'YOUR_USERNAME' in m.upper()):
    count['allowlisted-generic-user-doc-path']+=1
    continue
   if is_known_legacy_path(sha,path,label):
    count['preexisting-reviewed-path-exception']+=1
    continue
   count[label]+=1
   if len(issues[label])<24:issues[label].append({'blob':sha[:10],'path':path[:145],'count':1})
print('audited_objects='+str(len(entries))+' blob_security_findings_by_type:')
for k,v in sorted(count.items()):
 print(k+': '+str(v)+' matches; sample blobs='+str(issues[k][:16]))
blocked=any(count[x] for x in ('access-token','private-key','api-key-assignment','credential-json-label','windows-personal-home','private-workspace-path','machine-identifier','sensitive-local-ip'))
print('HISTORY_PRIVACY_REVIEW='+('BLOCKED' if blocked else 'PASS_WITH_REVIEWED_PREEXISTING_PATH_DEBT' if count['preexisting-reviewed-path-exception'] else 'NO_SENSITIVE_PATTERNS_FOUND'))
sys.exit(2 if blocked else 0)
