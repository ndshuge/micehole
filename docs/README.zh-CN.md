# MiceHole｜用 ChatGPT 额度实现免费 Codex 式远程施工

**手机下指令，电脑真施工。已有 ChatGPT 可用额度，就不必再为了 MiceHole 额外购买编程模型 API。**

MiceHole 把 ChatGPT 的对话式开发体验与 Windows 本机执行连起来：在手机或网页端提出需求，由电脑读取工程、修改代码、运行程序、排查 Bug。作者现有私有远程部署具备这条链路；GitHub Universal Preview 目前只交付本机 MCP 执行引擎，尚未向所有用户提供一键远程接入。

通用版本不再要求 Godot、Blender、Unity、ComfyUI，也不要求显卡。它通过 MCP 提供九个通用工具：状态、读取、写入、精确补丁、搜索、限时运行、进程管理、Git 和工程验证。

## 当前进度

- 已通过：独立的本地 MCP 服务握手和九项工具端到端测试。
- 已通过：长进程的启动、等待、输出和状态查询。
- 待验证：安装包在干净 Windows 上的安装卸载。
- 待解决：让第三方用户通过账号授权、安全远程连接复现作者现有的手机/网页施工链路；目前不能保证任何 ChatGPT Free/Plus 用户均可启用写入型自定义 MCP。

**产品主张是「免费 Codex 式体验」：用你已有的 ChatGPT 使用额度 + MiceHole 执行层，在本机完成真实施工。**「免费」指不需另购 MiceHole 模型 API，不包括 ChatGPT 套餐费用，也不意味着官方 Codex 不限量免费。

安装位置为 %LOCALAPPDATA%\Programs\MiceHole；配置与用户工作区单独存放，卸载不会删除用户工作区。安装后默认关闭任意命令执行；使用者必须阅读安全说明后主动开启。

- [在 ChatGPT 里怎么用？](CHATGPT-QUICKSTART.md)
- [安装指南](INSTALL.md)
- [安全说明](SECURITY.md)
- [连接指南](CONNECT.md)
- [验收和发布清单](RELEASE.md)

这不是 OpenAI 官方产品，亦不保证效果等同 Codex。
