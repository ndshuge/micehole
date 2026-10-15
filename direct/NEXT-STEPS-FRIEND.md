# 朋友完成最终个人授权

已提供 12 项本机及远程工具、个人工作区设置、官方 Tunnel 客户端及本机高权限同意门控。

**朋友需在自己的电脑操作：**
1. 运行 `setup-friend.ps1` 和 `scripts/friend-doctor.ps1`。
2. 运行 `scripts/enable-remote-high-privilege.ps1`，仔细阅读警告并手动输入确认短语。
3. 在自己的 OpenAI Platform 账号创建 Tunnel ID 和运行密钥。
4. 运行 `scripts/remote-setup.ps1 -TunnelId tunnel_YOUR_ID`，仅在本机隐藏提示中输入密钥。
5. 使用 `scripts/remote-doctor.ps1 -ConfigurationOnly` 检查，然后运行 `scripts/remote-run.ps1` 启动。
6. 在自己的 ChatGPT 账号添加个人 Tunnel MCP 连接，完成授权后验证 status、run、GUI、浏览器。

**请勿分享密钥、公网开放命令执行接口或使用管理员运行服务。** 同一 Windows 用户的高权限执行进程可能接触 Tunnel 凭据。此版本可测试，但尚未通过不同账号的远程安全和可靠性验收。详情见 `docs/V3-DIRECT.md`。
