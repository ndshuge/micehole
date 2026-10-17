"""Bounded Chat engineering operations behind the existing B2 engineering tool.

This is a transport adapter. Git and worktree authority remains with project-lab;
receipts here are evidence, never Runtime Truth. No shell command is accepted.
"""
from __future__ import annotations

import ast
import hashlib
import ctypes
import json
import os
import re
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from project_lab.adapters.git.local import LocalGitAdapter
from project_lab.adapters.local.engineering import LocalShellGitExecutorAdapter
from project_lab.application.engineering.chat_envelope import PROTECTED_PATH_PATTERNS
from project_lab.application.engineering.environment import EnvironmentProfile, EnvironmentResolver
from project_lab.application.engineering.worktrees import LocalWorktreeManager
from project_lab.domain.enums import EnvironmentClass

ROOT = Path(os.environ.get("MOUSE_HOLE_WORKSPACE") or os.environ.get("HANAKO_WORKSPACE") or str(Path.home() / "MiceHoleWorkspace")).resolve()
REPOS = {
    "project-lab": ROOT / "projects" / "project-lab",
    "openhanako-runtime": ROOT / "projects" / "openhanako-runtime",
}
STATE = Path(os.environ.get("HANAKO_EPHEMERAL_STATE", str(ROOT / "work" / "bridge" / "ephemeral-sessions")))
MANAGED = ROOT / "work" / "bridge" / "engineering" / "scratch" / "managed"
PYTHON = Path(os.environ.get("HANAKO_EPHEMERAL_TEST_PYTHON", str(ROOT / "projects" / "project-lab" / ".venv" / "Scripts" / "python.exe")))
TTL = 4 * 3600
ACTIONS = ("git.inspect", "python.syntax", "python.pytest", "sqlite.select", "source.identity", "source.patch", "candidate.commit")
PROFILE_ID = "project-lab-python-pytest-v1"
SAFE_ID = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$")
SAFE_REF = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,100}$")
SOURCE_SUFFIXES = {".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".json"}
GIT = LocalGitAdapter()
os.environ.update({"GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "NUL", "GIT_CONFIG_COUNT": "2", "GIT_CONFIG_KEY_0": "core.hooksPath", "GIT_CONFIG_VALUE_0": "NUL", "GIT_CONFIG_KEY_1": "core.fsmonitor", "GIT_CONFIG_VALUE_1": "false", "GIT_TERMINAL_PROMPT": "0", "GIT_PAGER": "cat"})


class Refused(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def need(ok: bool, code: str) -> None:
    if not ok:
        raise Refused(code)


def under(path: Path, root: Path) -> bool:
    return path == root or root in path.parents


def repo_of(value: object) -> tuple[str, Path]:
    need(isinstance(value, str) and value in REPOS, "REPOSITORY_NOT_ALLOWED")
    repo = REPOS[value].resolve()
    need(under(repo, ROOT) and repo.is_dir(), "REPOSITORY_NOT_ALLOWED")
    # Local filter drivers can execute programs during checkout/add. The two
    # registered repositories have none; refuse if an operator adds one later.
    try:
        configured = subprocess.run(["git", "config", "--local", "--name-only", "--get-regexp", r"^filter\..*\.(clean|smudge|process)$"], cwd=repo, capture_output=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        raise Refused("GIT_CONFIGURATION_UNAVAILABLE") from None
    need(configured.returncode == 1, "GIT_FILTER_DRIVER_DENIED")
    return value, repo


def protected(rel: str, *, database: bool = False) -> bool:
    from fnmatch import fnmatch

    parts = rel.lower().split("/")
    if ".git" in parts or "agents.md" in parts or "claude.md" in parts:
        return True
    patterns = [pat for pat in PROTECTED_PATH_PATTERNS if not database or pat not in ("*.db", "*.sqlite", "*.sqlite3")]
    return any(fnmatch(rel.lower(), pat.lower()) or fnmatch(rel.lower(), f"*/{pat.lower()}") for pat in patterns)


def relative(value: object, *, source: bool = False, database: bool = False) -> str:
    need(isinstance(value, str) and 0 < len(value) <= 240, "PATH_NOT_ALLOWED")
    value = value.replace("\\", "/")
    need(not value.startswith("/") and not re.match(r"^[a-zA-Z]:", value), "PATH_NOT_ALLOWED")
    parts = value.split("/")
    need(all(p not in ("", ".", "..") for p in parts), "PATH_NOT_ALLOWED")
    need(not protected(value, database=database), "SECRET_OR_PROTECTED_PATH")
    if source:
        need(Path(value).suffix.lower() in SOURCE_SUFFIXES, "SOURCE_PATH_REQUIRED")
    return value


def checked_file(base: Path, rel: str, *, existing: bool = True) -> Path:
    target = base / rel
    need(under(target, base), "PATH_NOT_ALLOWED")
    for part in [base, *list(target.parents)[:-1], target]:
        if under(part, base) and part.exists():
            need(not part.is_symlink(), "LINK_NOT_ALLOWED")
    if existing:
        need(target.is_file() and under(target.resolve(), base.resolve()), "PATH_NOT_ALLOWED")
    return target


def state_path(sid: str) -> Path:
    need(bool(re.fullmatch(r"[0-9a-f]{32}", sid)), "SESSION_NOT_FOUND")
    return STATE / (sid + ".json")


def save(record: dict) -> None:
    STATE.mkdir(parents=True, exist_ok=True)
    target = state_path(record["session_id"])
    temp = STATE / (record["session_id"] + "." + uuid.uuid4().hex + ".tmp")
    with temp.open("x", encoding="utf-8") as stream:
        json.dump(record, stream, sort_keys=True)
        stream.flush()
        os.fsync(stream.fileno())
    temp.replace(target)


def load(sid: object, identity: dict) -> dict:
    need(isinstance(sid, str), "SESSION_OFF")
    file = state_path(sid)
    need(file.is_file(), "SESSION_OFF")
    record = json.loads(file.read_text(encoding="utf-8"))
    need(record.get("audit_identity") == identity, "SESSION_IDENTITY_MISMATCH")
    need(not record.get("disabled_at"), "SESSION_DISABLED")
    need(datetime.now(timezone.utc) < datetime.fromisoformat(record["expires_at"]), "SESSION_EXPIRED")
    return record


def command(argv: list[str], cwd: Path, *, seconds: int = 20, limit: int = 16000) -> dict:
    env = {key: os.environ[key] for key in ("SYSTEMROOT", "WINDIR", "TEMP", "TMP") if key in os.environ}
    env.update({"PATH": os.environ.get("PATH", ""), "GIT_CONFIG_NOSYSTEM": "1", "GIT_TERMINAL_PROMPT": "0", "GIT_CONFIG_GLOBAL": "NUL", "GIT_CONFIG_COUNT": "2", "GIT_CONFIG_KEY_0": "core.hooksPath", "GIT_CONFIG_VALUE_0": "NUL", "GIT_CONFIG_KEY_1": "core.fsmonitor", "GIT_CONFIG_VALUE_1": "false", "GIT_PAGER": "cat", "PYTHONIOENCODING": "utf-8", "PYTHONDONTWRITEBYTECODE": "1"})
    try:
        done = subprocess.run(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL, capture_output=True, timeout=seconds)
    except subprocess.TimeoutExpired:
        raise Refused("COMMAND_TIMEOUT") from None
    return {"exit_code": done.returncode, "stdout": done.stdout[:limit].decode("utf-8", "replace"), "stderr": done.stderr[:limit].decode("utf-8", "replace"), "stdout_truncated": len(done.stdout) > limit, "stderr_truncated": len(done.stderr) > limit}


def candidate(record: dict, name: str, repo: Path, *, create: bool = False) -> tuple[Path, dict]:
    entries = record.setdefault("candidates", {})
    info = entries.get(name)
    if info is None:
        need(create, "CANDIDATE_NOT_FOUND")
        base = GIT.head(repo)
        path = MANAGED / f"ephemeral-{record['session_id']}-{name}" / f"repo-{name}"
        branch = f"ephemeral/{record['session_id'][:12]}/{name}"
        LocalWorktreeManager(GIT, MANAGED).prepare(repository=repo, worktree=path, base_commit=base, branch_name=branch)
        info = {"path": str(path), "branch": branch, "base_commit": base, "repository_identity": GIT.repository_identity(repo), "allowed_paths": []}
        entries[name] = info
        save(record)
    path = Path(info["path"]).resolve()
    need(under(path, MANAGED.resolve()) and path.is_dir(), "CANDIDATE_INVALID")
    need(GIT.repository_identity(path) == info["repository_identity"] == GIT.repository_identity(repo), "CANDIDATE_INVALID")
    need(GIT._run(path, "branch", "--show-current").stdout.strip() == info["branch"], "CANDIDATE_INVALID")
    need(info["branch"] not in ("main", "master"), "CANONICAL_WRITE_DENIED")
    return path, info


def git_inspect(request: dict, record: dict) -> dict:
    name, repo = repo_of(request.get("repository"))
    which = request.get("target", "canonical")
    need(which in ("canonical", "candidate"), "TARGET_NOT_ALLOWED")
    cwd = candidate(record, name, repo)[0] if which == "candidate" else repo
    verb = request.get("command")
    need(verb in ("status", "diff", "show", "log", "rev-parse", "branch", "ls-files"), "GIT_COMMAND_DENIED")
    ref = request.get("ref", "HEAD")
    need(isinstance(ref, str) and bool(SAFE_REF.fullmatch(ref)) and not ref.startswith("-"), "GIT_REF_DENIED")
    path = request.get("path")
    rel = relative(path) if path is not None else None
    if verb in ("diff", "show", "ls-files"):
        need(rel is not None, "GIT_PATH_REQUIRED")
    if rel:
        checked_file(cwd, rel)
    argv = {"status": ["status", "--short", "--branch"], "diff": ["diff", "--no-ext-diff", "--"], "show": ["show", "--format=fuller", "--no-ext-diff", ref, "--"], "log": ["log", "-10", "--format=%h %s", ref, "--"], "rev-parse": ["rev-parse", "--verify", ref], "branch": ["branch", "--list"], "ls-files": ["ls-files", "--"]}[verb]
    if rel and verb in ("diff", "show", "log", "ls-files"):
        argv.append(rel)
    result = command(["git", "--no-pager", *argv], cwd)
    return {"repository": name, "target": which, "command": verb, **result}


def sqlite_select(request: dict, record: dict) -> dict:
    name, repo = repo_of(request.get("repository"))
    rel = relative(request.get("database"), database=True)
    need(Path(rel).suffix.lower() in (".db", ".sqlite", ".sqlite3"), "DATABASE_NOT_ALLOWED")
    db = checked_file(repo, rel)
    sql = request.get("sql")
    need(isinstance(sql, str) and len(sql) <= 4000, "SQL_NOT_ALLOWED")
    stripped = sql.strip().rstrip(";").strip()
    need(bool(re.match(r"(?is)^select\s", stripped)) and ";" not in stripped, "SQL_READ_ONLY_REQUIRED")
    uri = db.as_uri() + "?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=2)
    try:
        conn.execute("PRAGMA query_only=ON")
        conn.set_progress_handler(lambda: 1 if time.monotonic() > deadline else 0, 1000)
        deadline = time.monotonic() + 5
        denied = {sqlite3.SQLITE_INSERT, sqlite3.SQLITE_UPDATE, sqlite3.SQLITE_DELETE, sqlite3.SQLITE_CREATE_TABLE, sqlite3.SQLITE_DROP_TABLE, sqlite3.SQLITE_ALTER_TABLE, sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH, sqlite3.SQLITE_PRAGMA}
        sensitive = re.compile(r"(?i)(secret|token|credential|api.?key|password|private.?key)")
        def authorize(action, arg1, arg2, *_):
            if action in denied:
                return sqlite3.SQLITE_DENY
            if action == sqlite3.SQLITE_READ and (sensitive.search(arg1 or "") or sensitive.search(arg2 or "")):
                return sqlite3.SQLITE_DENY
            return sqlite3.SQLITE_OK
        conn.set_authorizer(authorize)
        cursor = conn.execute(stripped)
        columns = [item[0] for item in cursor.description]
        rows = cursor.fetchmany(101)
        need(len(rows) <= 100, "SQL_ROW_LIMIT")
        safe_rows = [[value.hex()[:256] if isinstance(value, bytes) else value for value in row] for row in rows]
        encoded = json.dumps(safe_rows, default=str)
        need(len(encoded) <= 16000, "SQL_OUTPUT_LIMIT")
        return {"repository": name, "columns": columns, "rows": safe_rows}
    finally:
        conn.close()


def patch_source(request: dict, record: dict) -> dict:
    need(request.get("target", "candidate") == "candidate", "CANONICAL_WRITE_DENIED")
    name, repo = repo_of(request.get("repository"))
    patch = request.get("patch")
    before = request.get("before")
    scope = request.get("allowed_paths")
    need(isinstance(patch, str) and 0 < len(patch) <= 100000 and "GIT binary patch" not in patch, "PATCH_NOT_ALLOWED")
    need(isinstance(before, dict) and 0 < len(before) <= 20, "BEFORE_IDENTITY_REQUIRED")
    need(isinstance(scope, list) and 0 < len(scope) <= 20, "SCOPE_REQUIRED")
    paths = [relative(p, source=True) for p in before]
    allowed = [relative(p, source=True) for p in scope]
    need(len(set(paths)) == len(paths) and len(set(allowed)) == len(allowed) and set(paths) <= set(allowed), "SCOPE_DENIED")
    headers = re.findall(r"(?m)^diff --git a/(.+?) b/(.+?)$", patch)
    need(bool(headers) and {a for a, b in headers} == set(paths) and all(a == b for a, b in headers), "PATCH_PATH_MISMATCH")
    need(set(re.findall(r"(?m)^--- a/(.+)$", patch)) == set(paths) and set(re.findall(r"(?m)^\+\+\+ b/(.+)$", patch)) == set(paths), "PATCH_PATH_MISMATCH")
    need(not re.search(r"(?m)^(?:new file mode|deleted file mode|old mode|new mode|rename |copy |--- /dev/null|\+\+\+ /dev/null)", patch), "PATCH_MODE_DENIED")
    cwd, info = candidate(record, name, repo, create=True)
    need(not info.get("result_commit"), "CANDIDATE_ALREADY_COMMITTED")
    need(GIT.head(repo) == info["base_commit"], "CANONICAL_HEAD_CHANGED")
    need(not info["allowed_paths"] or set(allowed) == set(info["allowed_paths"]), "SCOPE_CHANGED")
    need(not GIT.changed_paths(cwd), "CANDIDATE_DIRTY")
    for rel in paths:
        file = checked_file(cwd, rel)
        need(isinstance(before[rel], str) and hashlib.sha256(file.read_bytes()).hexdigest() == before[rel].lower(), "BEFORE_IDENTITY_MISMATCH")
    check = subprocess.run(["git", "apply", "--check", "-"], input=patch.encode(), cwd=cwd, capture_output=True, timeout=20)
    need(check.returncode == 0, "PATCH_CHECK_FAILED")
    applied = subprocess.run(["git", "apply", "-"], input=patch.encode(), cwd=cwd, capture_output=True, timeout=20)
    need(applied.returncode == 0, "PATCH_APPLY_FAILED")
    changed = GIT.changed_paths(cwd)
    need(set(changed) == set(paths), "PATCH_SCOPE_VIOLATION")
    info["allowed_paths"] = allowed
    save(record)
    return {"repository": name, "candidate": str(cwd), "branch": info["branch"], "base_commit": info["base_commit"], "changed_paths": list(changed)}


def source_identity(request: dict, record: dict) -> dict:
    name, repo = repo_of(request.get("repository"))
    cwd, info = candidate(record, name, repo, create=True)
    rel = relative(request.get("path"), source=True)
    file = checked_file(cwd, rel)
    need(file.stat().st_size <= 1000000, "SOURCE_TOO_LARGE")
    return {"repository": name, "candidate": str(cwd), "branch": info["branch"], "base_commit": info["base_commit"], "path": rel, "sha256": hashlib.sha256(file.read_bytes()).hexdigest(), "bytes": file.stat().st_size}


def candidate_commit(request: dict, record: dict) -> dict:
    need(request.get("target", "candidate") == "candidate", "CANONICAL_WRITE_DENIED")
    name, repo = repo_of(request.get("repository"))
    cwd, info = candidate(record, name, repo)
    need(GIT.head(repo) == info["base_commit"], "CANONICAL_HEAD_CHANGED")
    changed = GIT.changed_paths(cwd)
    need(bool(changed), "NO_CANDIDATE_CHANGES")
    need(set(changed) <= set(info["allowed_paths"]) and all(not protected(p) for p in changed), "SCOPE_DENIED")
    need(GIT.head(cwd) == info["base_commit"], "CANDIDATE_HEAD_CHANGED")
    message = request.get("message")
    need(isinstance(message, str) and 1 <= len(message) <= 120 and "\n" not in message, "COMMIT_MESSAGE_DENIED")
    sid = record["session_id"]
    digest = hashlib.sha256((sid + name + info["base_commit"] + ",".join(changed)).encode()).hexdigest()
    commit = GIT.commit_changes(cwd, message=message, operation_id="ephemeral-" + digest[:24], task_id="ephemeral-" + sid, attempt_id="1", repository_identity=info["repository_identity"], base_commit=info["base_commit"], contract_fingerprint=digest, allowed_paths=tuple(info["allowed_paths"]), forbidden_paths=PROTECTED_PATH_PATTERNS)
    info["result_commit"] = commit
    save(record)
    return {"repository": name, "candidate": str(cwd), "branch": info["branch"], "base_commit": info["base_commit"], "result_commit": commit, "canonical_unchanged": GIT.head(repo) == info["base_commit"]}


def python_pytest(request: dict, record: dict) -> dict:
    name, repo = repo_of(request.get("repository"))
    cwd, info = candidate(record, name, repo, create=True)
    # Running Chat-patched Python would give that code the host user's file access.
    # Until an OS file sandbox is available, only the clean base candidate may run.
    need(not info.get("result_commit") and GIT.head(cwd) == info["base_commit"] and not GIT.changed_paths(cwd), "PYTEST_REQUIRES_CLEAN_BASE")
    test_path = relative(request.get("test_path"))
    need(test_path.startswith("tests/") and test_path.endswith(".py"), "TEST_PATH_DENIED")
    checked_file(cwd, test_path)
    seconds = request.get("timeout_seconds", 60)
    need(isinstance(seconds, int) and 1 <= seconds <= 120, "TIMEOUT_DENIED")
    profile = EnvironmentProfile(name=PROFILE_ID, environment_class=EnvironmentClass.SELF_CONTAINED, trusted_executables=(("python", str(PYTHON)),), argv_policies=(("python", (("-I", "-B", "-m", "pytest"),)),), acceptance_checks=("pytest",))
    need(EnvironmentResolver().supports_restricted_execution(profile), "EXECUTION_PROFILE_UNAVAILABLE")
    return {"repository": name, **run_registered_pytest(cwd, test_path, seconds)}


def python_syntax(request: dict, record: dict) -> dict:
    name, repo = repo_of(request.get("repository"))
    cwd, _ = candidate(record, name, repo)
    rel = relative(request.get("path"), source=True)
    need(rel.endswith(".py"), "PYTHON_SOURCE_REQUIRED")
    file = checked_file(cwd, rel)
    need(file.stat().st_size <= 100000, "SOURCE_TOO_LARGE")
    try:
        ast.parse(file.read_text(encoding="utf-8"), filename=rel)
    except (SyntaxError, UnicodeError) as error:
        return {"repository": name, "path": rel, "valid": False, "line": getattr(error, "lineno", None)}
    return {"repository": name, "path": rel, "valid": True}


def _windows_job(process: subprocess.Popen) -> int:
    """Put pytest and descendants into a kill-on-close Job Object before running it."""
    from ctypes import wintypes

    class Basic(ctypes.Structure):
        _fields_ = [("PerProcessUserTimeLimit", ctypes.c_longlong), ("PerJobUserTimeLimit", ctypes.c_longlong), ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t), ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD), ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]

    class IO(ctypes.Structure):
        _fields_ = [(name, ctypes.c_ulonglong) for name in ("ReadOperationCount", "WriteOperationCount", "OtherOperationCount", "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

    class Extended(ctypes.Structure):
        _fields_ = [("BasicLimitInformation", Basic), ("IoInfo", IO), ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.SetInformationJobObject.restype = wintypes.BOOL
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.AssignProcessToJobObject.restype = wintypes.BOOL
    job = kernel.CreateJobObjectW(None, None)
    need(bool(job), "PROCESS_CONTAINMENT_UNAVAILABLE")
    info = Extended()
    info.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not kernel.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info)) or not kernel.AssignProcessToJobObject(job, int(process._handle)):
        kernel.CloseHandle(job)
        process.kill()
        raise Refused("PROCESS_CONTAINMENT_UNAVAILABLE")
    return int(job)


def _terminate_descendants(pid: int) -> None:
    """Windows Toolhelp fallback for children that escaped a nested Job Object."""
    from ctypes import wintypes

    class Entry(ctypes.Structure):
        _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD), ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", wintypes.DWORD), ("cntThreads", wintypes.DWORD), ("th32ParentProcessID", wintypes.DWORD), ("pcPriClassBase", wintypes.LONG), ("dwFlags", wintypes.DWORD), ("szExeFile", wintypes.WCHAR * 260)]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(Entry)]
    kernel.Process32FirstW.restype = wintypes.BOOL
    kernel.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(Entry)]
    kernel.Process32NextW.restype = wintypes.BOOL
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
    kernel.TerminateProcess.restype = wintypes.BOOL
    snapshot = kernel.CreateToolhelp32Snapshot(0x2, 0)
    need(snapshot not in (None, -1), "PROCESS_TREE_INSPECTION_FAILED")
    parents = {}
    try:
        entry = Entry()
        entry.dwSize = ctypes.sizeof(Entry)
        if kernel.Process32FirstW(snapshot, ctypes.byref(entry)):
            while True:
                parents[int(entry.th32ProcessID)] = int(entry.th32ParentProcessID)
                if not kernel.Process32NextW(snapshot, ctypes.byref(entry)):
                    break
    finally:
        kernel.CloseHandle(snapshot)
    descendants = {pid}
    for _ in range(len(parents)):
        found = {child for child, parent in parents.items() if parent in descendants}
        if found <= descendants:
            break
        descendants |= found
    for target in sorted(descendants - {pid}, reverse=True):
        handle = kernel.OpenProcess(0x0001, False, target)
        if handle:
            kernel.TerminateProcess(handle, 1)
            kernel.CloseHandle(handle)


def run_registered_pytest(cwd: Path, test_path: str, seconds: int) -> dict:
    # Reuse the restricted executor's minimal environment. A Job Object closes the
    # Windows process-tree gap found in its taskkill fallback.
    env = LocalShellGitExecutorAdapter._clean_environment()
    env.update({"PYTHONNOUSERSITE": "1", "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1"})
    process = subprocess.Popen([str(PYTHON), "-I", "-B", "-m", "pytest", "-q", "--assert=plain", "-p", "no:cacheprovider", test_path], cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0, start_new_session=os.name != "nt")
    job = None
    try:
        if os.name == "nt":
            job = _windows_job(process)
        else:
            raise Refused("PROCESS_CONTAINMENT_UNAVAILABLE")
        captures = {}

        def drain(label, stream):
            digest = hashlib.sha256()
            total = 0
            preview = bytearray()
            while chunk := stream.read(8192):
                digest.update(chunk)
                total += len(chunk)
                if len(preview) < 2000:
                    preview.extend(chunk[:2000 - len(preview)])
            captures[label] = {"sha256": digest.hexdigest(), "bytes": total, "truncated": total > 16000, "preview": preview.decode("utf-8", "replace")}

        threads = [threading.Thread(target=drain, args=("stdout", process.stdout), daemon=True), threading.Thread(target=drain, args=("stderr", process.stderr), daemon=True)]
        for thread in threads:
            thread.start()
        try:
            process.wait(timeout=seconds)
        except subprocess.TimeoutExpired:
            if job is not None:
                _terminate_descendants(process.pid)
                kernel = ctypes.WinDLL("kernel32", use_last_error=True)
                kernel.TerminateJobObject.argtypes = [ctypes.c_void_p, ctypes.c_uint]
                kernel.TerminateJobObject.restype = ctypes.c_int
                killed = kernel.TerminateJobObject(ctypes.c_void_p(job), 1)
                need(bool(killed), "PROCESS_CONTAINMENT_TERMINATION_FAILED")
            process.wait(timeout=10)
            raise Refused("COMMAND_TIMEOUT") from None
        finally:
            for thread in threads:
                thread.join(timeout=10)
        need(all(not thread.is_alive() for thread in threads), "OUTPUT_CAPTURE_FAILED")
        return {"exit_code": process.returncode, "stdout_sha256": captures["stdout"]["sha256"], "stderr_sha256": captures["stderr"]["sha256"], "stdout_bytes": captures["stdout"]["bytes"], "stderr_bytes": captures["stderr"]["bytes"], "stdout_truncated": captures["stdout"]["truncated"], "stderr_truncated": captures["stderr"]["truncated"], "stdout_preview": captures["stdout"]["preview"], "stderr_preview": captures["stderr"]["preview"]}
    finally:
        if job is not None:
            ctypes.WinDLL("kernel32").CloseHandle(ctypes.c_void_p(job))
        elif process.poll() is None:
            process.kill()


def run(payload: dict) -> dict:
    request = payload.get("request") or {}
    identity = payload.get("identity") or {}
    operation = request.get("operation")
    need(request.get("kind") == "EPHEMERAL_ENGINEERING_SESSION", "BAD_SESSION_REQUEST")
    need(identity.get("source") == "openai-mcp" and bool(identity.get("subject") or identity.get("session")), "AUDIT_IDENTITY_REQUIRED")
    if operation == "enable":
        need(request.get("confirmation") == "ENABLE_EPHEMERAL_ENGINEERING", "EXPLICIT_ENABLE_REQUIRED")
        now = datetime.now(timezone.utc)
        sid = uuid.uuid4().hex
        record = {"session_id": sid, "created_at": now.isoformat(), "expires_at": (now + timedelta(seconds=TTL)).isoformat(), "workspace": str(ROOT), "allowed_repositories": list(REPOS), "allowed_actions": list(ACTIONS), "execution_profile_id": PROFILE_ID, "audit_identity": identity, "candidates": {}, "disabled_at": None}
        save(record)
        return {key: record[key] for key in ("session_id", "created_at", "expires_at", "workspace", "allowed_repositories", "allowed_actions", "execution_profile_id")}
    record = load(request.get("session_id"), identity)
    if operation == "disable":
        record["disabled_at"] = datetime.now(timezone.utc).isoformat()
        save(record)
        return {"session_id": record["session_id"], "disabled": True}
    if operation == "status":
        return {"session_id": record["session_id"], "created_at": record["created_at"], "expires_at": record["expires_at"], "allowed_actions": record["allowed_actions"], "candidates": {name: {"branch": info["branch"], "result_commit": info.get("result_commit")} for name, info in record["candidates"].items()}}
    need(operation in ACTIONS, "ACTION_DENIED")
    return {"git.inspect": git_inspect, "python.syntax": python_syntax, "python.pytest": python_pytest, "sqlite.select": sqlite_select, "source.identity": source_identity, "source.patch": patch_source, "candidate.commit": candidate_commit}[operation](request, record)


if __name__ == "__main__":
    try:
        incoming = json.load(sys.stdin)
        answer = {"ok": True, "result": run(incoming)}
    except Refused as error:
        answer = {"ok": False, "error": {"code": error.code, "message": error.code}}
    except Exception as error:
        # Never echo payloads or paths in an exception across the remote boundary.
        answer = {"ok": False, "error": {"code": "ENGINEERING_INTERNAL_ERROR", "message": type(error).__name__}}
    print(json.dumps(answer, ensure_ascii=False, default=str))
