from pathlib import Path
r=Path(r"E:\CHATGPT\downloads\micehole-v3-release-work")
file=r/"docs/V3-DIRECT.md"
old=file.read_text(encoding="utf-8")
add="""## 高权限远程模式（明确由 Windows 用户启用）

V3 实验性远程高权限入口为 `direct/micehole-remote.cmd`。保留与本地相同的 12 项工具，不再强制只开放五项文件工具。它必须经朋友本机明确确认后才会执行。Tunnel 客户端采用官方独立二进制文件，运行密钥用当前 Windows 用户的 DPAPI 加密保存。

个人操作步骤（在解压目录 `direct` 下运行 PowerShell）：

1. `powershell -NoProfile -File .\\setup-friend.ps1`。
2. `powershell -NoProfile -File .\\scripts\\friend-doctor.ps1`，确保 12 项工具已注册。
3. `powershell -NoProfile -File .\\scripts\\enable-remote-high-privilege.ps1`，阅读风险并在朋友电脑上键入 `ENABLE HIGH PRIVILEGE`。
4. 到 OpenAI Platform 为**自己的**账号创建 Tunnel ID 和运行密钥（不把密钥发给作者或粘贴在聊天中）。
5. `powershell -NoProfile -File .\\scripts\\remote-setup.ps1 -TunnelId tunnel_YOUR_ID`，在隐藏输入框输入个人运行密钥。
6. `powershell -NoProfile -File .\\scripts\\remote-doctor.ps1 -ConfigurationOnly`，检查配置；然后执行 `powershell -NoProfile -File .\\scripts\\remote-run.ps1`。
7. 在有权限的 ChatGPT 账号里使用相应的个人 Tunnel 注册私人 MCP 连接，完成授权，先测试 `mouse_hole_status`，然后在可丢弃工作区验证高权限操作。
8. 随时可执行 `powershell -NoProfile -File .\\scripts\\enable-remote-high-privilege.ps1 -Disable` 来禁止后续的远程服务启动。已经启动的会话应同时停止 Tunnel 进程。

**安全限制：** 远程高权限意味着 ChatGPT 能以当前 Windows 用户身份运行任意命令、管理进程、控制 GUI 和浏览器。只有自己的私有认证 Tunnel 才能使用。由于与 Tunnel 密钥处于同一 Windows 用户权限，程序的独立凭据隔离仍未验证，存在密钥被读取和机器被控制的风险。工作区文件限制不是命令沙箱。不要使用管理员身份运行，更不要将本机执行端口直接公网暴露。

**验收范围：** 本地模拟已证实“不授权拒绝启动、授权后列出 12 项工具”。不同 Windows 主机、ChatGPT 账号的真实远程配对、认证边界、浏览器/GUI 测试及断线恢复仍须真人验收。

"""
file.write_text(old.replace("## 尚未通过的发布门槛",add+"## 尚未通过的发布门槛"),encoding="utf-8")
readme=r/"README.md"
txt=readme.read_text(encoding="utf-8")
txt=txt.replace("**尚未完成安全隔离与真实朋友电脑配对验收**","**高权限远程入口已实现（需本机明确授权）；凭据隔离及朋友实机配对仍未验收**")
readme.write_text(txt,encoding="utf-8")
nextf=r/"direct/NEXT-STEPS-FRIEND.md"
nextf.write_text("""# 朋友完成最终个人授权

已提供 12 项本机及远程工具、个人工作区设置、官方 Tunnel 客户端及本机高权限同意门控。

**朋友需在自己的电脑操作：**
1. 运行 `setup-friend.ps1` 和 `scripts/friend-doctor.ps1`。
2. 运行 `scripts/enable-remote-high-privilege.ps1`，仔细阅读警告并手动输入确认短语。
3. 在自己的 OpenAI Platform 账号创建 Tunnel ID 和运行密钥。
4. 运行 `scripts/remote-setup.ps1 -TunnelId tunnel_YOUR_ID`，仅在本机隐藏提示中输入密钥。
5. 使用 `scripts/remote-doctor.ps1 -ConfigurationOnly` 检查，然后运行 `scripts/remote-run.ps1` 启动。
6. 在自己的 ChatGPT 账号添加个人 Tunnel MCP 连接，完成授权后验证 status、run、GUI、浏览器。

**请勿分享密钥、公网开放命令执行接口或使用管理员运行服务。** 同一 Windows 用户的高权限执行进程可能接触 Tunnel 凭据。此版本可测试，但尚未通过不同账号的远程安全和可靠性验收。详情见 `docs/V3-DIRECT.md`。
""",encoding="utf-8")
print("V3 remote docs updated")
