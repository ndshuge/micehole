from pathlib import Path
import shutil,re
repo=Path(r"E:\CHATGPT\downloads\micehole-v3-release-work")
source=Path(r"E:\CHATGPT\projects\openhanako-runtime")
target=repo/"direct"/"mcp"/"remote"
target.mkdir(parents=True,exist_ok=True)
for f in (source/"mcp"/"remote").iterdir():
    if f.is_file() and f.suffix in (".mjs",".ps1",".py"):
        if f.name in ("gui-native-batch.py","gui-native-button.py","gui-placement.ps1","gui-windows.ps1","b2_gate_adapter.py","ephemeral-engineering.py") or f.suffix==".mjs":
            shutil.copy2(f,target/f.name)
dest=repo/"direct"/"tools"/"mouse-hole"
dest.mkdir(parents=True,exist_ok=True)
for name in ("bounded-batch.mjs","gui-uia-stage.py","prepare-preview.py","prepare-preview-fast.mjs"):
    f=source/"tools"/"mouse-hole"/name
    if f.exists():shutil.copy2(f,dest/name)
core=target/"mouse-hole-core.mjs"
data=core.read_text(encoding="utf-8")
data=data.replace('export const MOUSE_HOLE_TOOLS = [...core, ...applicationTools];','export const MOUSE_HOLE_TOOLS = [...core, ...applicationTools].filter(tool => !["mouse_hole_blender", "mouse_hole_godot", "mouse_hole_comfyui"].includes(tool.name));')
core.write_text(data,encoding="utf-8")
bridge=target/"bridge-core.mjs"
d=bridge.read_text(encoding="utf-8")
d=d.replace('export const DEFAULT_WORKSPACE = "E:\\\\CHATGPT";','export const DEFAULT_WORKSPACE = process.env.MOUSE_HOLE_WORKSPACE || process.env.HANAKO_WORKSPACE || process.cwd();')
bridge.write_text(d,encoding="utf-8")
cmd=repo/"direct"/"micehole-direct.cmd"
cmd.write_text('@echo off\nsetlocal\nif not defined MOUSE_HOLE_WORKSPACE set "MOUSE_HOLE_WORKSPACE=%USERPROFILE%\\MiceHoleWorkspace"\nif not exist "%MOUSE_HOLE_WORKSPACE%" mkdir "%MOUSE_HOLE_WORKSPACE%"\nwhere node >nul 2>nul\nif errorlevel 1 (echo Please install Node.js LTS. 1>&2 & exit /b 1)\nnode "%~dp0mcp\\remote\\mouse-hole-server.mjs"\n',encoding="utf-8")
print("Copied",len(list(target.iterdir())),"MCP modules; filtered 3 specialist tools; source preserved.")
