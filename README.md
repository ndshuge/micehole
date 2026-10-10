# MiceHole Universal · v0.1.0 Beta

**在自己的 Windows 电脑上运行 MCP 工具；连接自己的 ChatGPT 与 Secure MCP Tunnel。**

[Windows 下载](https://github.com/ndshuge/micehole/releases) · [首次安装](docs/INSTALL.md) · [个人 Tunnel 设置](docs/SELF-HOSTED.md) · [安全说明](docs/SECURITY.md) · [English](docs/README.en.md) · [开发日志](docs/DEVLOG.md)

> **早期公开测试版，功能有限；不是 OpenAI 官方产品，也不是完整 Codex 替代品。** 安装与个人 Tunnel 的离线配置经过测试，但尚未完成独立新用户真实 ChatGPT 账号配对验收。客户端、套餐和工作区是否允许自定义写入型 MCP 取决于 OpenAI 的实际支持，不能保证所有 Free/Plus 或手机用户可用。

## 首版实际能做什么？

| 操作 | 本地 stdio MCP | 个人 Tunnel 远程 MCP |
| --- | --- | --- |
| 查询状态、读取/搜索授权目录中的文件 | ✅ | ✅ |
| 创建文件、修改/补丁文本 | ✅ | ✅ |
| PowerShell、运行测试和构建 | 明确本地启用后可用；**不属于安全沙箱** | **关闭** |
| Git 命令、进程启动/等待/结束 | 本地明确启用后可用 | **关闭** |
| 自动化工程全流程（执行 → 测试 → 修复） | 取决于本地客户端与授权 | **首版不支持** |
| 自定义插件注册和手机端可用性 | 取决于客户端 | **未完成跨账号验证** |

远程入口只有五项安全受限工具：`mouse_hole_status`、`mouse_hole_read`、`mouse_hole_write`、`mouse_hole_patch`、`mouse_hole_search`。仅允许明确指定的工作区。**不要把本地工具中具有的终端能力误认为已经通过个人 Tunnel 开放。**

## 下载

在 [GitHub Releases](https://github.com/ndshuge/micehole/releases) 下载 Windows x64 文件：

- `MiceHole-Universal-0.1.0-Setup.exe` — 当前用户安装，默认无需管理员权限。
- `MiceHole-Universal-0.1.0-Windows-x64.zip` — 无需安装的便携版。
- `SHA256SUMS.txt` — 下载后核对两份安装包的 SHA256。

安装包内含 Node.js 运行时和官方 `tunnel-client`（保留其第三方许可）。无须另外购买 MiceHole 编程模型 API；ChatGPT 和 OpenAI Platform/Tunnel 的资格、限额和费用仍按各自政策。

**注意：** 安装包尚未提供数字签名；Windows SmartScreen 可能提示未知发布者。不要关闭杀毒软件或绕过组织设备策略。

## 第一次使用

1. 先看 [Windows 安装与卸载](docs/INSTALL.md)，下载后校验 SHA256，安装并启动 `MiceHole Doctor`。
2. 检查工作区路径。建议只授权一个新的测试项目，不要选整个系统盘、私人文档或密钥目录。
3. **本地 MCP 客户端**：将 `micehole.cmd` 配置为客户端的 stdio MCP 程序；见 [连接示例](docs/CONNECT.md)。
4. **个人 ChatGPT Tunnel（实验性）**：先确认自己的账号有 OpenAI Platform Tunnel 和 ChatGPT 私人 MCP 插件权限，再按 [SELF-HOSTED](docs/SELF-HOSTED.md) 在本机进行隐藏密钥配置、手动启动和健康检查。下载 EXE **不会自动在 ChatGPT 创建插件**。
5. 从 ChatGPT 测试状态、读取、写入和搜索一个**可丢弃的测试项目**。不要尝试远程 Shell、Git 或构建。

管理窗口 `MiceHole Control` 可以显示状态，并在用户明确同意后配置后台恢复。模拟崩溃恢复测试通过，但真实重启、睡眠唤醒和各类代理网络变化仍需外部实测。

## 安全与限制

- 本地启用命令执行的程序将继承 Windows 当前账户权限。工作区目录限制**不构成命令沙箱**。个人 Tunnel 远程版始终锁定此能力。
- Tunnel 凭据以当前用户的 Windows DPAPI 加密存储；同一账户的任意恶意程序理论上仍可访问。因此禁止远程运行任意命令。
- 不要把真实 Tunnel 密钥、API Key、个人配置或者私有文件上传到 Issues。遇到漏洞请先阅读 [SECURITY.md](docs/SECURITY.md)。
- 卸载会移除软件及其明确创建的后台任务。个人工作区和用户配置可能保留；清理或撤销 Tunnel 凭据请参照 [安装指南](docs/INSTALL.md)。

## 开发进度与源码

- [开发日志](docs/DEVLOG.md)、[验收矩阵](docs/RELEASE.md)、[GitHub Issues](https://github.com/ndshuge/micehole/issues)、[Actions 实测](https://github.com/ndshuge/micehole/actions)。
- W2-A/B/C 是**未随首版打包**的 Windows Worker 隔离研究原型。通过临时 Windows 测试机的实验不等于完成普通用户版 Worker；不得据此解锁远程命令。
- 本仓库采用 MIT 许可；Node.js 和 OpenAI 官方 Tunnel 客户端保留其各自许可和 NOTICE。

*独立社区开源项目，与 OpenAI 或 Codex 没有官方关联。*
