# MiceHole V3：网络连接诊断小更新

**一句话：ChatGPT 连不上电脑，先找出是哪里不通，而不是反复重启。**

## 适合谁？

如果你用 MiceHole 让 ChatGPT 在 Windows 电脑上远程读写文件、运行项目，偶尔可能遇到工具离线、代理节点掉线、MCP Tunnel 无法连接等问题。这次提供一个**可选的只读检查工具**，帮助先定位网络故障范围。

## 本次新增

- **网络诊断脚本**：检查本地代理端口、一般 HTTPS、OpenAI API 的基础可达性，必要时检查本地 Tunnel 健康端口。
- **清晰的故障分类**：区分本地代理没启动、上游网络不通、OpenAI 访问路径问题、需要进一步检查个人 Tunnel 的情况。
- **复用现有 Clash/Mihomo 能力**：已有 `fallback` 的用户可以用它做节点故障转移，不需要安装第二个节点切换器。

**不增加新的 Agent、不增加后台程序、不改高权限授权边界。**

## 快速体验

在 MiceHole V3 Direct 目录打开 PowerShell：

```powershell
powershell -NoProfile -File .\scripts\network-doctor.ps1 -ProxyUri 'http://127.0.0.1:7897'
```

7897 仅为示例；请换成**你自己**的 Clash HTTP/Mixed 端口。不使用代理的用户可省略 `-ProxyUri` 做直连测试。

## 重要边界

- **不会自动切换你的节点**：实际切换由你本机已有的 Clash/Mihomo `fallback` 完成，你需要自己配置。
- **不会读取机场订阅、密钥、个人文件，也不会修改系统代理或 DNS**。
- **无法直接判断机场流量是否耗尽**：诊断报告会明确显示“流量未知”，提醒你去订阅服务商页面核实。
- **HTTP 可达不等于 ChatGPT 端 MCP 已连接**：远程工具仍需在 ChatGPT 中实测。
- 开发者本机用的“检查并修复双桥.cmd”“强制重启双桥.cmd”属于个人双桥部署脚本，**不包含在朋友版 V3 中**。

## 本轮验证

在开发者 Windows 机器上通过脚本语法检查、无效代理端口识别，以及实际本地代理对 Google/OpenAI 的 HTTPS 探测；V3 Direct 原有测试通过。朋友电脑、跨账号远程执行、节点掉线自动恢复尚未完成独立验收。

**发布说明：这是针对 `main` 源码的功能更新说明；已发布的 v3.0.0 ZIP 不会自动更新。** 后续正式打包时才会随新安装包提供。

[详细使用说明](NETWORK-RELIABILITY.zh-CN.md) · [V3 安装指南](INSTALL-V3.zh-CN.md)
