# MiceHole V3 · Windows 与 ChatGPT 完整安装指南

本手册分为 **Windows 本机安装 → 本机验证 → 独立 Tunnel → ChatGPT 授权 → 真人验收**。每位朋友使用自己的账号、路径和凭据。GitHub V3 已是正常 Release，但远程高权限安全隔离和朋友跨账号真实连接仍需验收。

## 0. 下载和校验

从 [GitHub V3.0.0 发行页](https://github.com/ndshuge/micehole/releases/tag/v3.0.0) 下载 `MiceHole-V3-Windows-x64.zip` 与 `MiceHole-V3-SHA256SUMS.txt`。在 PowerShell 运行：

```powershell
Get-FileHash .\MiceHole-V3-Windows-x64.zip -Algorithm SHA256
```

将结果与校验文件逐字符对照。不匹配就停止安装。解压到自己的文件夹，例如 `D:\Apps\MiceHoleV3`。不需要拥有作者相同的 E 盘、公网 IP 或 Windows 用户名。

## 1. Windows 本机初始化

先安装 Node.js，再在解压目录打开 PowerShell：

```powershell
powershell -NoProfile -File .\setup-friend.ps1
powershell -NoProfile -File .\scripts\friend-doctor.ps1
```

可自定义工作区：

```powershell
powershell -NoProfile -File .\setup-friend.ps1 -Workspace 'D:\MyProjects'
```

Doctor 应显示 `local_ready: true` 与 `tools_count: 12`。Python、浏览器和其他程序是否可用需按具体工具另测。个人配置保存在 Windows 自己的 `%LOCALAPPDATA%\MiceHoleV3`。可兼容本地 stdio MCP 的客户端入口为 `micehole-direct.cmd`。

## 2. 电脑上明确开启远程高权限

> [!CAUTION]
> **下一步是危险权限。** 此服务能以 Windows 登录用户身份执行 Shell、管理进程和操作 GUI/浏览器。它不是系统沙箱，可能访问用户能够访问的文件和凭据。不要以管理员身份启动；不要使用未经认证的公网端口。

朋友本人在自己的电脑上执行：

```powershell
powershell -NoProfile -File .\scripts\enable-remote-high-privilege.ps1
```

阅读风险提示并自行输入确认短语。未经确认的远程启动应被阻止。

## 3. OpenAI Platform 端：自己的 Tunnel

朋友需在自己的 OpenAI Platform 账号中创建个人 Tunnel ID 与对应的**运行密钥**，不能复制作者的 Tunnel ID、密钥或已加密 DPAPI 文件。首次配置时在本机输入：

```powershell
powershell -NoProfile -File .\scripts\remote-setup.ps1 -TunnelId 'tunnel_YOUR_OWN_ID'
powershell -NoProfile -File .\scripts\remote-doctor.ps1 -ConfigurationOnly
```

安装包中的官方 Tunnel 客户端是独立二进制；运行密钥由本机隐藏输入保存，不应贴进 ChatGPT、GitHub Issues 或安装日志。然后启动：

```powershell
powershell -NoProfile -File .\scripts\remote-run.ps1
```

首次测试时保持此窗口运行，在另一窗口执行 `remote-doctor.ps1` 检查。Tunnel 资格、访问控制与具体客户端命令以 OpenAI Platform 实际可用功能为准。

## 4. ChatGPT 端：自己的连接器

在账号或工作区支持自定义 MCP 的前提下，朋友在 ChatGPT 的插件/连接器页面添加个人 Tunnel MCP，选择自己的 Tunnel 并授权。不同平台和账号展示的菜单可能不同。先在聊天中试：

> 检查老鼠洞状态和工具列表，不要修改任何文件，也不要运行命令。

随后才在**可丢弃测试目录**测试写入、验证、命令与 GUI。不能把“工具列表里有 run”直接当作真实远程高权限已成功。

## 5. 常见排错

| 现象 | 优先检查 |
|---|---|
| 找不到 Node | 安装 Node.js 并重启终端 |
| 工具数不足 12 | 安装包与 friend-doctor 是否为 V3 |
| Tunnel 未连通 | 个人 ID/运行密钥、Tunnel 健康检查、代理与网络 |
| ChatGPT 中找不到服务 | 账号权限、插件授权与客户端支持 |
| 命令可以运行但 GUI 不工作 | Windows 交互桌面、窗口前台、授权与焦点 |
| 路径找不到 | 使用 setup-friend 配置自己真实目录，别复制作者 E 盘路径 |

关闭未来的远程高权限入口：

```powershell
powershell -NoProfile -File .\scripts\enable-remote-high-privilege.ps1 -Disable
```

同时需关闭已经启动的 Tunnel 与执行进程；关闭未来启动开关不必然终止已存在的会话。必要时撤销或轮换自己的密钥。

## 6. 验收标准

本机 Doctor 成功 → 个人 Tunnel 健康检查成功 → ChatGPT 发现工具 → 在临时工程完成文件写入、实际有界命令和结果核验 → 根据需要单独验证浏览器与 GUI。**朋友必须自己做的只有本机环境/权限同意、独立 Tunnel 密钥和 ChatGPT 授权及测试。**

[返回首页](../README.md) · [技术架构](ARCHITECTURE-V3.md) · [版本验收现状](V3-DIRECT.md)