# MiceHole V3 · 手动更新（不会自动更新）

适用于 **已安装 V3、已有自己的 Tunnel/工作区** 的 Windows 用户。**先读完再动手**。不必重新申请 Tunnel ID，不必重新输入或复制密钥。

## 为什么不能直接把 ZIP 解压到新的安装路径？

个人 Tunnel 在首次设置时保存了 `tunnel_client`、`local_mcp_entry` 及 MCP profile 里的 **绝对安装路径**。如果从 `C:\Apps\MiceHoleV3` 改成 `D:\NewMiceHole`，旧配置可能仍指向原来目录，导致“更新了文件却还在运行旧版”或“Tunnel 找不到 MCP”。最简单、最稳妥的方案是 **保留原安装路径**。

## 安全更新步骤（建议）

1. 记录你的**原安装目录**和个人工作区。确认能正常进入原目录，并保留正在使用的工作区和所有个人数据。不要在更新过程中删除 `%LOCALAPPDATA%\MiceHoleV3`。
2. 从 Releases 下载**新版 ZIP + 对应 SHA256**，核验哈希，然后解压到同一磁盘的一个**临时新目录**。检查 ZIP 里能找到 `setup-friend.ps1`、`micehole-remote.cmd`、`scripts\friend-doctor.ps1`、`tunnel-client\tunnel-client.exe`。
3. **停止旧版自己的 Tunnel**（例如在运行 `remote-run.ps1` 的命令行按 Ctrl+C，或者使用你自己设置的启动入口停止）。等它真正退出；不要随意终止别人的进程。**不要修改 Windows 系统代理、DNS 或电脑上的其他应用。**
4. 将原安装目录重命名为同盘备份，例如 `C:\Apps\MiceHoleV3-backup-v3.0.0`。把新版临时目录移动或重命名为**完全相同的原安装路径** `C:\Apps\MiceHoleV3`。不要把新文件混合覆盖进旧目录。
5. 双击新版目录里的 `START-HERE.cmd`，或手动运行 `setup-friend.ps1` 与 `friend-doctor.ps1`。新版 Setup 在不指定 `-Workspace` 时会复用之前的工作区配置，并保留已有 `AGENTS.md`。检查 `WORKSPACE` 输出仍指向原工作区。
6. 由电脑主人重新启动**自己的** `scripts\remote-run.ps1`（或原本的个人启动任务），运行 `remote-doctor.ps1`，再从 ChatGPT 实际调用一次 `mouse_hole_status` 和一项安全只读工具，证明已经连接新版本。
7. 验证成功后，**先保留备份目录一段时间**；确认其他功能正常，再自行处理。不要自动删除个人旧版、工作区或凭据。

### 更新失败怎么回滚？

1. 停止**新** Tunnel；把当前安装目录重命名为 `MiceHoleV3-failed-v3.0.1`。
2. 将 `MiceHoleV3-backup-v3.0.0` 改回**原安装目录名**。
3. 运行旧版 Setup/Doctor 或个人启动入口，验证原 Tunnel、原工作区和 ChatGPT 工具。
4. 如果失败，请提供**去除账号、密钥、订阅 URL 后**的错误分类，而不是上传 `runtime-key.dpapi` 或私人配置。

### 什么时候需要重新配置？

- 如果你特意改变了安装目录、MCP 服务入口或官方 Tunnel 客户端位置：需要重新核对和更新个人 `settings.json` 与客户端 profile 的绝对路径，不能只改某一个路径。建议保留原路径以避免这一步。
- 如果两版官方 Tunnel 客户端不兼容：先回滚，查看发行说明与上游兼容性要求。
- 从非常旧的版本（例如 0.1 Beta）跨大版本升级，不应直接套用以上原路径更新方法，应先按最新安装指南核对权限和格式。

**更新只替换程序，不会自动更换 ChatGPT 套餐、提高额度或自动启用远程高权限。**
