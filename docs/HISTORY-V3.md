# MiceHole 开发历程：从对话到真正操作电脑

> 记录关键决定、踩坑与代码落地情况。本页根据项目对话、开发日志和 Git 提交梳理；尚未验证的能力不会写成已完成。

## 2026 年 9 月：从 OpenHanako 出发

项目最初试图将 ChatGPT、远程通信和本机执行串成闭环。我们研究过任务队列、Runtime、消费者、日志和持久状态，逐渐认识到：**任务成功进入队列不等于已经被执行，执行结果也必须可追踪、可验收。**

早期还遇到工具 schema 不一致、Tunnel/代理/DNS 连接、是否需要额外 HTTP 适配器等问题。后来确认可以用 Tunnel 将远程调用接向本地 stdio MCP 服务，明确区分“通信层”和“执行层”。

## 9 月底到 10 月初：连接、权限与可恢复性

为适应手机、网页和 Windows 等不同场景，探索独立 Tunnel 身份与 profile，避免多个实例复用相同凭据和工作状态。将工程状态写到 PROJECT.md、STATUS.md、TODO.md、LOG.md，逐渐形成 **短会话 + 持久 Markdown 状态**的模式。

## 10 月上旬：复杂 Agent 到直接施工

我们反复遇到“提交任务之后并未持续施工”的情况，转而坚持 **ChatGPT 作为主要决策层 → 直接 MCP 工具 → 实际结果反馈**。能直接用 CLI、API、结构化浏览器完成的步骤，就不强制走 GUI；GUI 使用时考虑窗口四象限与焦点冲突。对长时间命令采用进程管理、输出读取和后续验收。

## 10 月 10 日：公开 v0.1.0 Beta

早期 Universal Beta 主要提供有限的个人远程文件能力：本地工具更多，而个人 Tunnel 只开放五项受限远程工具；Shell 不开放。同期积累 Windows Worker 身份隔离原型、GitHub Actions、安装和卸载测试、公开开发日志。**这些实验不等于独立用户的生产级高权限验收。**

## 10 月 13–15 日：当前 Direct V3

我们明确目标：**把正在使用的老鼠洞真正移植给朋友，而不是重写功能缩减版。** V3 保留 12 项核心工具，去掉 Godot、Blender、ComfyUI 专用接口；修复个人盘符、用户名、工作区、Tunnel ID 等依赖；补上安装与自动测试；将高权限远程入口做成本机明确同意才能开启。

| 关键提交 / 发布 | 作用 |
|---|---|
| [fb33364](https://github.com/ndshuge/micehole/commit/fb33364) | 迁移 Direct 核心工具 |
| [4adee7f](https://github.com/ndshuge/micehole/commit/4adee7f) | 路径适配、自动集成测试 |
| [5556000](https://github.com/ndshuge/micehole/commit/5556000) | 朋友个人配置与安装向导 |
| [d1e87cf](https://github.com/ndshuge/micehole/commit/d1e87cf) | 修正工具状态中的旧能力标识 |
| [c1718ba](https://github.com/ndshuge/micehole/commit/c1718ba) | 私人 Tunnel、高权限启用门控 |
| [900e617](https://github.com/ndshuge/micehole/commit/900e617) | 推送主分支与 GitHub 首页 |
| [v3.0.0](https://github.com/ndshuge/micehole/releases/tag/v3.0.0) | 公开 Windows ZIP 和校验文件，正常 Release |

## 我们踩过的坑

| 问题 | 经验 |
|---|---|
| 以为任务入队就已完成 | 必须有执行器、结果和验收 |
| MCP 工具列表显示存在就当作可用 | 需要单独测试真实调用 |
| 把本机 E 盘/用户名写死 | 路径应可移植，个人配置不能进仓库 |
| 同时操作多个 GUI 窗口 | 单桌面焦点会冲突，结构化操作优先 |
| 无限拉长 session | 用工程文件保持上下文和施工里程碑 |
| Tunnel 已认证就以为命令执行安全 | 认证≠沙箱，同 Windows 用户的凭据隔离仍待验证 |

## 后续阶段

朋友独立 Windows 电脑与 ChatGPT 账号端到端配对；高权限远程真实执行；浏览器与 GUI 兼容性；安全隔离；断线续接；更新回滚与安装签名。以上都是待办，不能以 GitHub 正式 Release 名义替代验收。

[回到首页](../README.md) · [开发日志](DEVLOG.md)