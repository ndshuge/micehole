# 在 ChatGPT 中使用 MiceHole · v0.1.0 Beta

**目前仅提供五项个人 Tunnel 远程工具；这是公开早期测试，而非一键完整远程施工。**

## 先确认账号资格

Windows 安装包本身**不会**在 ChatGPT 自动创建插件。你需要有自己的
OpenAI Platform Tunnel ID、运行密钥，以及能创建并调用个人 MCP
连接的 ChatGPT 账号/工作区。自定义 MCP 写入能力、移动端支持和订阅
资格随官方产品政策变化；不能保证每位 Free/Plus 用户均可用。

## Windows 上的安装和配对

1. 从 [GitHub Releases](https://github.com/ndshuge/micehole/releases)
   下载 Windows x64 安装包和 SHA256SUMS，验证校验和。
2. 运行 MiceHole Doctor，确认仅授权你愿意交给 AI 修改的测试项目。
3. 跟随 [个人 Secure MCP Tunnel 指南](SELF-HOSTED.md) 配置自己的
   Tunnel ID 和隐蔽输入的运行密钥。
4. 先在前台启动 Tunnel 并用 `remote-doctor.ps1` 查看健康状态。
5. 在受支持的 ChatGPT 界面，按官方操作创建/安装**你自己的私人 MCP
   连接**，选择自己的 Tunnel，再检查工具发现结果。
6. 首次只验证 `mouse_hole_status` 和 `mouse_hole_read`。确认工作区
   后，在可丢弃文件上测试 `write`、`patch` 和 `search`。

工具名称和入口以实际客户端显示为准。手机客户端是否支持自定义写入型
MCP 取决于版本和账号；如果没有选项，请勿尝试开放本机公网端口。

## 首版可以使用的指令

> 检查 MiceHole 是否连接，列出可用工具与允许访问的工作区。只读，不做修改。

> 在我已授权的临时网页项目中，读取 index.html，修复一段 CSS，并列出具体变更文件。不要运行命令。

> 在我的测试项目内搜索某个函数名，并精确替换错误文本；不要访问目录以外的文件。

**不能在当前远程版要求 ChatGPT 运行 PowerShell、Git、测试或长进程**。
本地 stdio MCP 模式可以在单独授权后运行命令，但这不是 Windows 安全
沙箱，也不能因此认为远程命令安全开放。

## 常见问题

**是否要购买 MiceHole 模型 API？** 不需要。你使用自己已有的兼容 AI
客户端以及 OpenAI Platform Tunnel/ChatGPT 资格，可能仍有平台费用和额度限制。

**安装完为什么没有 ChatGPT 插件？** EXE 是电脑端程序；个人 ChatGPT
MCP 插件需要另外创建或安装，并取决于账号是否支持。

**没有连接怎么办？** 使用 `scripts\remote-doctor.ps1 -ConfigurationOnly`
检查配置，随后检查前台 Tunnel 和 ChatGPT 侧插件权限。

**如何停止？** 关闭前台 Tunnel；如开启了后台任务，用 Control 的
Stop background / Remove autostart。撤销访问还应在 OpenAI Platform
撤销运行密钥并移除 ChatGPT 私人插件。详见 [INSTALL](INSTALL.md)。

**是否有安全风险？** 远程文件写入会改变工作区内容，建议使用 Git
和可丢弃项目。不要向任何人分享 Tunnel 密钥。详见 [SECURITY](SECURITY.md)。
