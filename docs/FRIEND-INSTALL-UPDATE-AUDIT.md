# MiceHole V3 · 朋友安装、更新与版本差异（2026-10-17）

## 最小可维护方案：GitHub Release + ZIP + SHA256 + 两次检查

采用 GitHub CLI 和常见 Windows 工具的简单发布模式：朋友从 **Releases** 下载明确版本的 ZIP 和 SHA256 清单，验证后解压，使用现有 Setup、Doctor。暂不开发自动更新器、常驻监控程序、winget/Scoop 清单或新的 GUI 安装向导。

### 首次安装

1. 从本仓库 Releases 下载最新标记的 Windows V3 ZIP 和对应 SHA256 文件。对照校验值，解压到个人文件夹。
2. 安装 Node.js（如果下载包未自带）；在解压目录运行 `powershell -NoProfile -File .\setup-friend.ps1`。
3. 安装时在用户自己的工作区**仅当不存在时**创建轻量 `AGENTS.md`，已有内容绝不覆盖。该规则要求 ChatGPT 优先探索陌生软件的官方文档/CLI/API，GUI 兜底，按需读取项目状态，只有重要里程碑才写 MD。
4. 运行 `powershell -NoProfile -File .\scripts\friend-doctor.ps1`，目标是 `local_ready: true` 和 `tools_count: 12`。
5. 每位朋友**单独**配置自己的 Tunnel 与 ChatGPT MCP 授权。高权限 Shell/GUI 需要明确启用并自行验收；不要复制作者 ID、令牌或工作区。

### 更新现有安装

1. 阅读 Release Notes 和兼容性说明；保留当前版本的 ZIP/安装目录作为回滚入口。
2. 停止**本人的** MiceHole Tunnel 会话后，解压新 ZIP 到**新目录**，而不是覆盖正在运行的旧版本。
3. 从新目录运行 `setup-friend.ps1 -Workspace '自己已有工作区的绝对路径'`；它不会覆盖已有 `AGENTS.md`。用户数据、项目 Markdown 和个人 Tunnel 密钥应仍位于各自独立路径，**不要移动或复制密钥文件**。
4. 在新目录先运行 `friend-doctor.ps1`，再检查个人 Tunnel 的运行与 ChatGPT 远程工具测试。成功后再切换自己已授权的启动入口。
5. 如果失败，关闭新版本，恢复旧目录启动入口；不删除用户工作区和个人凭据。

### 两个容易混淆的地方

- **main 分支与 Release ZIP 不等价**。源码更新不会自动进入之前发布的安装包；只有新版本打包、校验、下载检查后才能宣称“朋友下载即可用”。
- 作者本机的 Hanako+MiceHole 双桥、Clash 机场分流和两个专用 CMD **不属于**通用 MiceHole 发布包。朋友版只有单套独立 MiceHole 工具与本人 Tunnel；不能复制开发者私人代理、认证信息。

## 本次线上审计的差异与风险

| 范围 | 事实与处理 |
| --- | --- |
| 本机工作区 AGENTS | 开发机已拥有全局规范；原先朋友版首次安装不生成。已在待发布源码中补足，首次创建、再次保留，实测通过。 |
| 陌生软件主动探索 | 本机 AGENTS 已写 API/CLI 优先与研究官方文档原则；新公开模板加入相同简明原则。没有增加 Agent、MCP 工具或软件自动适配器。 |
| MD 续工机制 | main 的 `docs/MD-HABITS.md` 已记录规则发现/状态续工/幂等里程碑；该机制不代表 ChatGPT 每个会话自动加载规则。 |
| 网络诊断 | main 已含可选 `direct/scripts/network-doctor.ps1` 与使用指南；截至本次审计，v3.0.0 ZIP 未核实包含新脚本，应视为旧包。 |
| 本机双桥自愈 | 开发者私有 Hanako Supervisor、强刷与 Clash 自动节点切换已实测部分能力；公开 V3 不应该直接复制这套开发环境脚本或机场配置。 |
| Release 发布状态 | 当前 GitHub Release 仍为 `v3.0.0`。不能把 main 上的文档改进当作新版 ZIP 已发布。 |
| 朋友的独立安装 | 本机 stdio/12 工具测试通过；跨账号远程连接、断线恢复、升级回滚在朋友机器上仍需真人验收。 |

**建议发布门槛：** 仅在干净目录打包 V3 Direct，校验新 ZIP 的文件清单、哈希、全新工作区初始化、重复安装不覆盖、12 工具与权限门控后，再创建新版本的 GitHub Release。已有 v3.0.0 不要替换原二进制资产，以便用户安全回滚。
