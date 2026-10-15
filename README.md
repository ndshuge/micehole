# MiceHole V3 · Windows MCP Bridge

**V3 Direct Port is now the main-branch development preview.** The existing v0.1.0 GitHub Release installer is still the old limited remote edition, **not V3**. Independent ChatGPT account / Windows device end-to-end validation is still pending.

[中文 V3 安装指南](docs/V3-DIRECT.md) · [朋友部署步骤](direct/NEXT-STEPS-FRIEND.md) · [安全说明](docs/SECURITY.md) · [历史 Releases](https://github.com/ndshuge/micehole/releases)

## 功能范围

保留 12 个工具：status、read、write、patch、search、run、process、git、validate、browser、observe、gui。明确移除 Godot、Blender、ComfyUI 三个专用工具。

- Windows 本机 stdio：在开发电脑上完成握手、工具清单、工作区读写及可迁移路径测试。
- 个人 Tunnel 高权限入口：可以在朋友的 Windows 上显式启用；未授权启动被拒绝，授权后可注册全部 12 项工具。朋友真实远程调用和安全隔离未验收。
- 适配不同 Windows 用户、磁盘、工作区和包含空格的路径；公网 IP、Tunnel ID、运行密钥不能复用作者的。

## 开始安装

1. 下载当前仓库代码（不要下载仍标记 v0.1.0 的旧版 Release），或使用 `powershell -File scripts/build-direct-port.ps1` 构建便携 ZIP。
2. 在 Windows 安装 Node.js；进入 `direct` 运行 `powershell -NoProfile -File .\setup-friend.ps1`。
3. 运行 `powershell -NoProfile -File .\scripts\friend-doctor.ps1`，预期工具数是 12。
4. 本地 MCP 客户端使用 `direct\micehole-direct.cmd`。ChatGPT 个人 Tunnel 的步骤请完整阅读 [V3 安装指南](docs/V3-DIRECT.md)。

## 高权限与安全

远程启用后，Shell、GUI 和浏览器能以 Windows 当前用户身份执行操作。**工作区路径限制不是命令沙箱。** 本版尚未证明执行进程和同一 Windows 用户的 Tunnel 凭据完全隔离。只允许用户自己的私有认证 Tunnel，不要暴露未经认证的公网端口，不要以管理员身份运行，首次只在可丢弃测试工作区验证。

## 验收与版本

已完成：开发机 MCP 握手、12 工具注册、移除三个专用工具、独立工作区测试、含空格目录搬迁、远程入口未授权阻止/授权后工具发现。

尚未完成：朋友真实 ChatGPT 账号配对、完整远程命令与 GUI 实测、凭据隔离安全审计、断线与升级测试。因此 main 中的 V3 仍是**源码预览**，并非已验证的稳定发行版。

[旧版安装说明](docs/INSTALL.md) · [旧版测试记录](docs/RELEASE.md) · [LICENSE](LICENSE)

独立社区开源项目，不隶属于 OpenAI。
