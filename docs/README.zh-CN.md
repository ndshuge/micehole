# MiceHole Universal｜通用 Windows 本机施工引擎

**目标：在 ChatGPT 对话里，让 AI 远程访问你自己的电脑、修改工程并运行测试。**

通用版本不再要求 Godot、Blender、Unity、ComfyUI，也不要求显卡。它通过 MCP 提供九个通用工具：状态、读取、写入、精确补丁、搜索、限时运行、进程管理、Git 和工程验证。

## 当前进度

- 已通过：独立的本地 MCP 服务握手和九项工具端到端测试。
- 已通过：长进程的启动、等待、输出和状态查询。
- 待验证：安装包在干净 Windows 上的安装卸载。
- 待解决：任何 ChatGPT Free/Plus 用户一键远程接入；目前并不能保证支持自定义完整写入型 MCP，手机端还有官方限制。

因此，不把它宣传为「人人免费的 Codex」。准确的描述是：**为兼容的 AI/MCP 客户端提供本机施工能力，不需要 MiceHole 自己的模型 API。**

安装位置为 %LOCALAPPDATA%\Programs\MiceHole；配置与用户工作区单独存放，卸载不会删除用户工作区。安装后默认关闭任意命令执行；使用者必须阅读安全说明后主动开启。

- [安装指南](INSTALL.md)
- [安全说明](SECURITY.md)
- [连接指南](CONNECT.md)
- [验收和发布清单](RELEASE.md)

这不是 OpenAI 官方产品，亦不保证效果等同 Codex。
