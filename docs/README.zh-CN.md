# MiceHole Universal v0.1.0 Beta

**下载到自己的 Windows 电脑，配置自己的 Tunnel，连接自己的 ChatGPT。**

[下载](https://github.com/ndshuge/micehole/releases) · [安装](INSTALL.md) · [个人 Tunnel](SELF-HOSTED.md) · [安全边界](SECURITY.md) · [开发记录](DEVLOG.md)

这是第一版**公开早期测试**，不是 OpenAI 官方产品，不是完整 Codex 替代品，也不提供额外模型额度。

| 能力 | 本地 MCP | 个人 Tunnel 远程 |
| --- | --- | --- |
| 状态、读取、搜索文件 | ✅ | ✅ |
| 写入、精确修改文件 | ✅ | ✅ |
| PowerShell、Git、运行项目、进程管理 | 需单独明确开启，且**不是沙箱** | **关闭** |
| 自动运行测试并持续修复 | 取决于本地客户端和授权 | **尚不支持** |

Windows EXE / 便携 ZIP 已包含 Node.js 和官方 `tunnel-client`。
用户还需要自己在 OpenAI Platform 获取 Tunnel ID 与运行密钥，并在
**受支持的** ChatGPT 账号/工作区中创建自己的私人 MCP 插件。
安装 EXE 不会自动获得 ChatGPT 插件权限。暂未完成独立普通用户的真实配对测试，
Free/Plus/移动端的写入型 MCP 兼容性不能保证。

第一步先阅读 [INSTALL](INSTALL.md)，下载后核对 SHA256，运行 Doctor，
只授权一个可丢弃的测试工作区。个人 Tunnel 的初始化和加密密钥保存请看
[SELF-HOSTED](SELF-HOSTED.md)。

安全提醒：远程只能使用五项文件/状态工具；命令执行所需的独立 Worker
尚未投入安装版。安装包目前未进行数字签名，真实重启恢复、跨账号配对、
升级回滚和外部安全审查仍在计划中。

项目源码采用 MIT 许可；Node.js、官方 Tunnel 客户端仍受各自许可证约束。
