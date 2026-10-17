# MiceHole V3：网络诊断与稳定连接（可选）

> 给朋友看的简短说明：**ChatGPT 连不上电脑时，先判断是网络、代理、机场，还是 MiceHole 自己出了问题。** 此更新增加一个只读网络检查工具，并介绍如何利用你**已有**的 Clash/Mihomo 故障转移功能。**它不是新的加速器，也不会替你购买订阅、安装 Clash、自动管理机场账号或绕过地域限制。**

## 这次到底更新了什么？

- **新增可选 `network-doctor.ps1`**：检查本机 HTTP 代理端口、一般 HTTPS、OpenAI API 的基础 HTTP 可达性，可选检查本地 Tunnel 健康端口。
- **故障定位优先于反复重启**：能区分“本地代理端口没开”“代理端口开了但外网不通”“普通网站通而 OpenAI 不通”“网络基础探测通过，应该继续排查 Tunnel/ChatGPT”。
- **不增加后台进程、权限或额外 MCP 工具**：MiceHole 依然是 ChatGPT 调用的执行工具，不是另一个 Agent。
- **Clash 自动换节点属于 Clash 自身功能**：如果你已经有 `fallback`，直接复用，**不需要让 MiceHole 再造一套切换器**。

## 朋友如何使用？

在 **V3 Direct 安装根目录**打开 PowerShell：

```powershell
# 没有专用本地代理时：仅检查直连；此测试显式不使用系统代理
powershell -NoProfile -File .\scripts\network-doctor.ps1

# 如果你用 Clash Verge 的本地 HTTP/Mixed 代理，例如 7897 端口
powershell -NoProfile -File .\scripts\network-doctor.ps1 -ProxyUri 'http://127.0.0.1:7897'

# 如果你知道个人 Tunnel 的本地健康端口，可附加检查（仅检查监听）
powershell -NoProfile -File .\scripts\network-doctor.ps1 -ProxyUri 'http://127.0.0.1:7897' -TunnelHealthPort 18791 -Json
```

没有使用 Clash 的朋友，不要照抄 7897；端口应当是自己代理应用实际监听的 HTTP 或 Mixed 端口。检测**不读取**订阅链接、节点密码、Tunnel ID 或密钥，不修改 DNS、系统代理、代理组，也不会重启任何服务。请勿把私人配置或完整连接日志发给别人。

### 怎样读报告？

| `classification` | 意思 | 先做什么 |
| --- | --- | --- |
| `network_probe_passed` | Google 返回正常 HTTP 响应，OpenAI API 有基础 HTTP 响应（通常是未登录的 401） | 若 ChatGPT 仍无法连接，检查个人 Tunnel/ChatGPT 连接器 |
| `local_proxy_not_listening` | 指定的本机代理端口没有进程监听 | 启动代理客户端或核对端口 |
| `proxy_or_upstream_unhealthy` | 参考 HTTPS 测试失败 | 检查代理网络、节点是否可用、订阅到期/流量是否不足 |
| `openai_path_or_policy_issue` | 普通 HTTPS 能通，但 OpenAI HTTP 基础探测不正常 | 检查代理出口、服务政策、节点兼容性和 Tunnel 日志 |
| `invalid_configuration_or_check_error` | 输入或检测过程异常 | 检查命令参数后重试 |

报告中的 `subscription_quota=unknown_check_provider` 是**刻意的**：本工具无法可靠查询所有机场的剩余流量，因此不会把“连接失败”直接推断为“流量耗尽”。请在自己的机场后台或 Clash 订阅页查看**用量、剩余额度和到期时间**。`remote_chatgpt_mcp=not_verified` 同样表示：本机探测不能证明 ChatGPT 端远程调用成功。

## 我已经在用 Clash，如何不重复造轮子？

在你自己的 Clash/Mihomo 配置中复用已有的 `fallback` 策略组：

1. 按个人线路实测选择候选节点；例如**新加坡 → 台湾 → 日本 → 美国**，并可自行排除不希望自动选择的地区。
2. `fallback` 按候选顺序尝试健康节点，不等同于追求最低延迟的 `url-test`。120 秒可作为起始健康检查间隔，需根据订阅容量和稳定性调整。
3. 确认**真正负责 Tunnel 访问 OpenAI 的分流规则**指向这个 `fallback`，否则“配置了故障转移”不代表它会生效。
4. 对远程连接的稳定性进行验证：节点故障可能打断正在使用的 MCP 长连接，需要 Tunnel 自己重连。**不能承诺零断线**。
5. 先检查可否通过原有客户端的订阅覆盖/增强方式持久化配置；只改运行时 YAML 可能被下一次订阅更新覆盖。

**不必为了本地指定代理就开启 Windows 系统代理**：如果某程序明确支持并使用 `127.0.0.1:端口`，即使系统代理关闭，也可以交由 Clash 分流。但是，仅仅启动 MiceHole 或运行上述诊断脚本，**不会自动把 Tunnel 流量改为走该代理**。具体 Tunnel 代理参数/环境变量请按其官方客户端文档设置并实测。

## 和「检查并修复双桥」「强制重启双桥」是什么关系？

这两个 CMD 是开发者**个人电脑上同时部署 MiceHole 与 Hanako 的维护入口**，并不是公开 V3 的通用安装组件。不要复制作者的脚本、私有路径、账户信息和 Tunnel 配置到朋友的电脑上。

V3 朋友版目前提供的是本机/远程 Doctor 与新的可选网络诊断。此更新**没有加入两个通用 CMD、没有自动安装看门狗，也没有修改高权限授权流程**。我们优先提供“先明确坏在哪里”的工具，再考虑是否有必要增强自动恢复。

## 本轮验收与限制

- Windows PowerShell 语法检查通过；关闭的本地端口可识别为 `local_proxy_not_listening`。
- 开发机通过显式 7897 代理测试：参考 HTTPS 返回 204，未携带凭证访问 OpenAI API 返回 401，报告为 `network_probe_passed`。
- **没有验证**朋友电脑、跨账户远程 MCP、不同代理软件的兼容性、机场实际流量额度识别、自动断线恢复和跨 Windows 重启。
- 这是 **main 分支源码与文档更新**。已有 v3.0.0 Release ZIP 不会自动包含新文件；在发布并核验新的安装包之前，请以源码中的新脚本为准。

[返回安装指南](INSTALL-V3.zh-CN.md) · [查看更新历史](../CHANGELOG.md) · [返回首页](../README.md)
