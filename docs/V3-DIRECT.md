# V3 Direct Port — Windows 移植预览

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
