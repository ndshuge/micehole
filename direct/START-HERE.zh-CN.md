# MiceHole V3 · 先看这里（Windows）

**新朋友：从这里安装。老朋友：请先看 `MANUAL-UPDATE.zh-CN.md`，不要直接覆盖旧安装文件。**

MiceHole 是 ChatGPT 在你明确授权后操作你自己 Windows 电脑的工具。它不是独立的 AI 大脑，也不会绕过 ChatGPT 账号的 MCP/Tunnel 权限、官方限制或安全规则。

## 首次安装（四步）

1. 从本项目 GitHub **Releases** 下载本版本 `MiceHole-V3.0.1-Windows-x64.zip` 和同版本的 `MiceHole-V3.0.1-SHA256SUMS.txt`。用 `Get-FileHash .\MiceHole-V3.0.1-Windows-x64.zip -Algorithm SHA256` 与清单核对；解压到你自己可写的目录（建议短路径，不需要作者电脑上的任何文件）。
2. 安装 Node.js LTS。打开解压目录，双击 **`START-HERE.cmd`**。它会执行本地 Setup 与 Doctor。也可以使用 PowerShell 手动运行：
   
   ```powershell
   powershell -NoProfile -File .\setup-friend.ps1
   powershell -NoProfile -File .\scripts\friend-doctor.ps1
   ```
   
   成功标志为 `MICEHOLE_SETUP_OK=true`，以及 Doctor 的 `local_ready: true`、`tools_count: 12`。
3. Setup 会为你创建或复用个人工作区；**仅在缺失时创建根 `AGENTS.md`**，里面包含陌生软件优先探索官方 API/CLI、项目续工按需读取、重要里程碑才写 MD 的简要规则。已有 `AGENTS.md` **绝不覆盖**。
4. 想从手机/ChatGPT 远程连接，还需**由电脑主人本人**在 OpenAI Platform 配置个人认证 Tunnel、保存自己的运行凭据，明确批准远程高权限，并在 ChatGPT 中连接自己的 MCP。参见仓库 [完整中文指南](https://github.com/ndshuge/micehole/blob/main/docs/INSTALL-V3.zh-CN.md)。不要向任何人发送密钥或作者的个人配置。

**安全提醒：** 授权远程 Shell/GUI 后，工具可能拥有当前 Windows 用户的文件和命令权限。MiceHole 不提供进程安全沙箱，不建议管理员运行，先在临时测试项目中验证。

## 双击后没有成功怎么办？

- `Node.js not found`：安装 Node.js 并重新打开命令行。
- `tools_count` 不是 12：确认解压了完整的官方 ZIP，且没有混用旧版文件。
- 本机就绪但 ChatGPT 不通：运行 `scripts\remote-doctor.ps1`，可选 `scripts\network-doctor.ps1`（网络诊断）；分别检查个人 Tunnel、账号插件授权及代理环境。
- 机场订阅流量耗尽：本工具**不能可靠自动判断**，需自行查看服务商订阅页。
- `AGENTS.md` 不存在：检查工作区路径及 Setup 输出；不要把开发者工作区复制过来。

[手动更新与回滚](MANUAL-UPDATE.zh-CN.md) · [网络诊断](https://github.com/ndshuge/micehole/blob/main/docs/NETWORK-RELIABILITY.zh-CN.md)
