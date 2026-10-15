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

## 高权限远程模式（明确由 Windows 用户启用）

V3 实验性远程高权限入口为 `direct/micehole-remote.cmd`。保留与本地相同的 12 项工具，不再强制只开放五项文件工具。它必须经朋友本机明确确认后才会执行。Tunnel 客户端采用官方独立二进制文件，运行密钥用当前 Windows 用户的 DPAPI 加密保存。

个人操作步骤（在解压目录 `direct` 下运行 PowerShell）：

1. `powershell -NoProfile -File .\setup-friend.ps1`。
2. `powershell -NoProfile -File .\scripts\friend-doctor.ps1`，确保 12 项工具已注册。
3. `powershell -NoProfile -File .\scripts\enable-remote-high-privilege.ps1`，阅读风险并在朋友电脑上键入 `ENABLE HIGH PRIVILEGE`。
4. 到 OpenAI Platform 为**自己的**账号创建 Tunnel ID 和运行密钥（不把密钥发给作者或粘贴在聊天中）。
5. `powershell -NoProfile -File .\scripts\remote-setup.ps1 -TunnelId tunnel_YOUR_ID`，在隐藏输入框输入个人运行密钥。
6. `powershell -NoProfile -File .\scripts\remote-doctor.ps1 -ConfigurationOnly`，检查配置；然后执行 `powershell -NoProfile -File .\scripts\remote-run.ps1`。
7. 在有权限的 ChatGPT 账号里使用相应的个人 Tunnel 注册私人 MCP 连接，完成授权，先测试 `mouse_hole_status`，然后在可丢弃工作区验证高权限操作。
8. 随时可执行 `powershell -NoProfile -File .\scripts\enable-remote-high-privilege.ps1 -Disable` 来禁止后续的远程服务启动。已经启动的会话应同时停止 Tunnel 进程。

**安全限制：** 远程高权限意味着 ChatGPT 能以当前 Windows 用户身份运行任意命令、管理进程、控制 GUI 和浏览器。只有自己的私有认证 Tunnel 才能使用。由于与 Tunnel 密钥处于同一 Windows 用户权限，程序的独立凭据隔离仍未验证，存在密钥被读取和机器被控制的风险。工作区文件限制不是命令沙箱。不要使用管理员身份运行，更不要将本机执行端口直接公网暴露。

**验收范围：** 本地模拟已证实“不授权拒绝启动、授权后列出 12 项工具”。不同 Windows 主机、ChatGPT 账号的真实远程配对、认证边界、浏览器/GUI 测试及断线恢复仍须真人验收。

## 尚未通过的发布门槛
独立朋友电脑的端到端测试、GUI/浏览器全依赖验证、远程高权限执行身份与 Tunnel 凭据隔离、私有 ChatGPT 插件配对与断线恢复、无秘密扫描、Windows 安装与升级完整体验。这些在通过前不得标记为生产就绪。
