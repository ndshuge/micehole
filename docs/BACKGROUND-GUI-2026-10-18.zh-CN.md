# MiceHole V3：后台优先 GUI（2026-10-18）

## 目标和变化

你打游戏、学习或输入文本时，AI 不应突然抢走 Windows 的鼠标和键盘。四象限只解决窗口摆放，不代表输入隔离。本功能继续让 ChatGPT 负责决策，MiceHole 只提供执行能力，不新增 Agent 调度系统。

1. **前台输入默认禁用。** GUI 坐标点击、移动、拖动、键盘输入、焦点切换、普通启动窗口，以及浏览器的前台启动和读屏，都需要操作级 foreground_control=true **和**运行当前会话时的 MOUSE_HOLE_GUI_FOREGROUND_MODE=allow；默认拒绝。
2. **后台原生按钮仍可用。** 对具备标准 Win32/WinForms Button 的窗口，带有精确窗口标题、按钮文字的语义 click 使用 BM_CLICK，不会移动真实鼠标或切换前台。自绘软件、Electron 页面不保证支持；需要相应 Python 运行环境。
3. **四象限不再默认启用。** MOUSE_HOLE_GUI_LAYOUT=quadrant 才激活已有的新建窗口布局和布局互斥锁；不设置时返回 layout_disabled，不改动布局。
4. **前台互斥和用户优先。** Windows GUI 实际物理输入采用跨进程互斥锁 Local\MouseHoleGuiInput。过去 3000 毫秒内检测到本机输入时拒绝操作，所有键盘操作强制精确目标窗口标题。这不能识别所有手柄输入，也无法防止第三方工具绕过 MiceHole。
5. **可选后台截图。** 现有 observe 工具设置 target=window、精确 title、path=background，使用 Win32 PrintWindow 捕获未最小化窗口。返回真实 PNG、尺寸与采样颜色数；找不到窗口、最小化和明显空白图像时明确失败。对 GPU、Electron、DRM 或旧帧的兼容仍需逐应用验收。
6. **原有接口保持。** 无头浏览器、CLI 和 API 不需要前台许可；公开版仍为 12 个 MCP 工具，没有新增虚拟机或常驻调度服务。

## 手动开启可见模式

默认不设置以下变量，按原安装指南启动，便是后台优先。

~~~powershell
# 想看新开窗口四象限时，在启动 MiceHole 之前设置：
$env:MOUSE_HOLE_GUI_LAYOUT = 'quadrant'
# 确认本人暂不使用电脑、明确允许前台动作时，才开启：
$env:MOUSE_HOLE_GUI_FOREGROUND_MODE = 'allow'
# 随后按现有流程启动 MiceHole Direct / Tunnel
~~~

这两个环境变量只在启动时继承。要恢复默认模式，请停止**自己的** MiceHole 会话，在不设置变量的新终端中启动。不要覆盖正在运行的服务或修改其他用户的工作区。

## 边界、测试与回滚

- 窗口重叠通常不影响原生控件操作；屏幕坐标点击仍会受遮挡影响。后台截图不等同于后台鼠标坐标控制。
- 多 Agent 的 CPU、GPU、内存竞争依旧存在，应设置资源预算。对共享前台桌面来说，此方案不能做到用户与多个 AI 各拥有独立鼠标。
- PrintWindow 可能返回无效或过期画面，最小化窗口通常无法可靠捕获。TeleAgent 未完成后台兼容验收。
- 旧版或第三方工具绕开互斥锁时不能获得同等保护；禁止宣称“绝对零干扰”。

~~~powershell
node scripts/tests/background-gui.test.mjs
node scripts/tests/background-window-live.mjs
node scripts/test-direct-port.mjs
~~~

回滚：停掉本人新版本的 MiceHole，重新使用保留的 v3.0.1 安装目录及配置即可；无需修改 Windows 系统策略或删除个人工作区。

本机已完成受控 WinForms 非前台窗口截图（460×240，7 个采样颜色）与原有 12 工具兼容性测试。独立用户远程 Tunnel、长时间多 Agent 并发及 TeleAgent 的专项验收不在本次完成范围。

## 后续验收（2026-10-18）

- 30 秒三个后台执行通道并行：后台截图 26 次、原生按钮点击 26 次、后台 CLI 40 次、前台标题抽样 52 次。测试窗口抢焦点 0 次，执行错误 0 次。前台记录到游戏和用户的 PowerShell 窗口，因此仅证明测试窗口未主动取得焦点，不代表整机焦点始终不变。
- TeleAgent 当前最小化，后台窗口捕获明确返回 minimized；没有恢复或抢占 TeleAgent 窗口，后台操作兼容性尚待在可见非前台状态验证。
- GitHub 历史审计：既有 5 个旧 Git Blob 共 7 处个人工作区路径，已登记精确对象 SHA 与源文件作为历史债务。公开 Git 历史并未删除；新路径、新 SHA、令牌和密钥类内容仍必须阻断 CI。独立临时仓库注入新路径的反向测试已通过。
- 测试来源：scripts/tests/multi-background-30s.mjs，scripts/tests/history-audit-regression.mjs；Windows GitHub CI 跑历史安全审计，真桌面并发验收在本机运行，不以非交互式 CI 冒充真机。
