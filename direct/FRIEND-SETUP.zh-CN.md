# MiceHole Direct V3：朋友电脑部署说明

本包来自作者正在使用的 Direct MCP 服务，保留 12 项工具，不包含 Godot、Blender、ComfyUI 专用工具。

## 电脑端（Windows）
1. 解压到自己的任意目录（路径可以带空格，不要求 E: 盘）。
2. 安装 Node.js（推荐受支持的 LTS 版本）。浏览器/G​UI的某些功能还可能需要 Python 和独立外部软件；它们不会自动替你安装。
3. 在解压目录运行 PowerShell：`powershell -NoProfile -File .\setup-friend.ps1`。
4. 需要自定义工作区时：`powershell -NoProfile -File .\setup-friend.ps1 -Workspace 'D:\MyProjects'`。此设置保存在你自己的 `%LOCALAPPDATA%\MiceHoleV3\workspace.txt`，不包含在公开源码/分享包中。
5. 本地 MCP stdio 入口为解压目录下的 `micehole-direct.cmd`。命令执行继承当前 Windows 登录用户权限，不应默认以管理员身份运行。

## ChatGPT 端
- 必须使用自己的 ChatGPT 账号及可用的自定义 MCP 连接能力。
- 必须自行建立经过认证的远程连接和私人 Tunnel；**此移植预览包没有提供已验收的远程高权限连接方案**。
- 公网 IP、动态公网出口、Tunnel 地址/ID、代理端口、ChatGPT 插件身份与凭据都属于朋友自己的配置，不应复制作者的值。
- 目前先测试本地 stdio 工具。不要将命令执行、GUI、浏览器接口通过无认证公网 HTTP 暴露。

## 测试与限制
- `setup-friend.ps1` 测试服务可启动并列出 12 个工具。
- 修改安装目录或 Windows 用户名后，运行本地程序无需编辑源码中的原电脑路径。
- 初步验证了 MCP 握手、状态、写文件、独立工作区和工具清单；真实 GUI 操作、浏览器依赖、远程连接仍需目标电脑验证。
- 对文件读写的工作区限制**不是 PowerShell 的安全沙箱**。不要把具有高权限执行能力的服务交给不可信的远程客户端。
