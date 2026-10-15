# 朋友开始使用前：唯一需要本人参与的操作

## 已经自动准备的内容
- Portable Direct MCP：12 项工具，保留 Shell / Process / Git / GUI / Browser；不含 Godot/Blender/ComfyUI。
- 任意路径、不同 Windows 用户、空格路径的本地启动与工作区测试。
- `setup-friend.ps1` 初始化私有工作区，`scripts/friend-doctor.ps1` 做本机检查。
- 预览 ZIP 带经过 SHA256 验证的官方 Tunnel 客户端（附许可证）。

## 朋友必须自行操作
1. 在**自己的 Windows 电脑**上解压包，安装 Node.js，运行 `powershell -NoProfile -File .\setup-friend.ps1`。
2. 运行 `powershell -NoProfile -File .\scripts\friend-doctor.ps1`，确认 `local_ready=true`。
3. 使用**自己的** OpenAI Platform 账号创建 Tunnel ID 与独立运行密钥；不要向作者、GitHub 或 ChatGPT 对话提供密钥。
4. 在自己的 ChatGPT 账号/工作区确认自定义 MCP Tunnel 连接权限，并自行完成连接授权。
5. 对远程高权限功能保持关闭：在独立 Windows Worker 与 Tunnel 凭据隔离验收前，不能将 Direct 的 Shell/GUI 原样接入公网 Tunnel。此预览包尚不具备安全的 ChatGPT 远程高权限配置向导。

## 注意
公网 IP、代理、网络出口、安装磁盘、用户名、Tunnel ID、运行密钥都是各自独立的，不能从作者电脑迁移。安装目录变化无需改源码。工作区限制不是系统命令沙箱。
