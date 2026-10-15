from pathlib import Path
r=Path(r"E:\CHATGPT\downloads\micehole-v3-release-work")
readme=r/"README.md"
old=readme.read_text(encoding="utf-8-sig")
header="""# MiceHole — 当前开发路线

> **V3 Direct Port 预览版正在独立分支开发。** 现有 GitHub Releases 的 v0.1.0 Beta 仍是受限远程文件操作版本；不要把 V3 当作已正式发布的远程高权限安装包。

**[查看 V3 分支](https://github.com/ndshuge/micehole/tree/v3-direct-port-preview)** · **[V3 使用指南](docs/V3-DIRECT.md)** · **[朋友配置步骤](direct/NEXT-STEPS-FRIEND.md)** · **[代码和测试](scripts/test-direct-port.mjs)**

| 项目 | V3 Direct Port 预览状态 |
| --- | --- |
| 已迁移的核心工具 | 12 项：文件、命令、进程、Git、验证、浏览器、观察、GUI |
| 专用工具 | Godot / Blender / ComfyUI 不在公开 MCP 工具列表中 |
| Windows 不同路径、带空格路径、本机启动 | 开发机测试通过 |
| 自己的工作区/用户名/网络/Tunnel 凭据 | 各自配置，绝不复用作者凭据 |
| ChatGPT 自定义 Tunnel + 远程高权限 | **尚未完成安全隔离与真实朋友电脑配对验收** |
| 正式主分支及 Release | **目前仍为 v0.1.0 Beta** |

**最新可测试代码**：请在 V3 分支获取源文件，在 Windows 上运行 `direct/setup-friend.ps1` 与 `direct/scripts/friend-doctor.ps1`。需要 Node.js；部分 GUI/浏览器功能另需依赖。高权限命令继承运行用户权限；工作区限定不等于命令沙箱。切勿把本地 stdio 高权限入口无认证暴露到公网。

---

"""
if not old.startswith("# MiceHole — 当前开发路线"):
    readme.write_text(header+old,encoding="utf-8")
(r/"docs"/"V3-DIRECT.md").write_text("""# V3 Direct Port — Windows 移植预览

## 与现有 Release 的区别
此分支移植了实际使用的 Direct MCP 执行引擎，不是仅有五项远程工具的 v0.1.0 版本。它在 **本机 stdio** 提供 12 个工具：status、read、write、patch、search、run、process、git、validate、browser、observe、gui。已从工具注册和状态能力列表移除 Godot / Blender / ComfyUI。

## 朋友首次配置（Windows）
1. 获取此分支代码，进入 `direct/`；或使用构建脚本生成的便携 ZIP。
2. 安装 Node.js，PowerShell 执行 `./setup-friend.ps1`，可用 `-Workspace 'D:\Projects'` 指定个人工作区。
3. 执行 `./scripts/friend-doctor.ps1`；检查 `local_ready: true`、`tools_count: 12`。
4. 在支持本地 stdio 的 MCP 客户端中，使用绝对路径指向 `micehole-direct.cmd`。
5. ChatGPT 端必须使用朋友自己的账号、Tunnel ID 和运行密钥，且连接能力取决于账号权限。**目前不提供已验收的远程高权限一键配置，不得把本地命令入口直接公开到互联网**。

## 路径、网络与凭据
- 不依赖作者的 E 盘、用户名、工作区或公网 IP。公网 IP 动态变化不要求修改引擎代码。
- 工作区由 `MOUSE_HOLE_WORKSPACE` 或用户本地配置确定。
- 密钥不存储在仓库、ZIP、GitHub Issues 或会话文字中。
- 完整 GUI 需要可用的 Windows 桌面会话；非交互式后台/远程会话不能保证相同操作行为。

## 已完成验收
本机 MCP 初始化、12 项工具清单、三项专用工具排除、状态读取、文件写入、独立工作区、含空格迁移目录通过。测试入口：`node scripts/test-direct-port.mjs`。另有打包入口：`powershell -File scripts/build-direct-port.ps1`。

## 尚未通过的发布门槛
独立朋友电脑的端到端测试、GUI/浏览器全依赖验证、远程高权限执行身份与 Tunnel 凭据隔离、私有 ChatGPT 插件配对与断线恢复、无秘密扫描、Windows 安装与升级完整体验。这些在通过前不得标记为生产就绪。
""",encoding="utf-8")
print("README and V3 documentation updated")
