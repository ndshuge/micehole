<div align="center">

# MiceHole

### 免费 Codex 式体验：用 ChatGPT 额度远程施工你的电脑

**Your ChatGPT quota. Your own PC. Real coding from anywhere.**

**不用为 MiceHole 另购编程模型 API。** 在 ChatGPT 发出任务，让 MiceHole 在自己的 Windows 电脑里改代码、运行程序、测试并修复。现有作者部署已能通过手机 ChatGPT 远程下达施工任务。

[![Windows](https://img.shields.io/badge/Windows-10%20%2F%2011-0078D4?logo=windows&logoColor=white)](#-下载与安装)
[![MCP](https://img.shields.io/badge/Protocol-MCP-6C57DD)](#-工作原理)
[![Release](https://img.shields.io/badge/Release-v0.1.0%20Preview-orange)](#-项目进度)
[![No MiceHole API](https://img.shields.io/badge/MiceHole%20API%20Key-Not%20Required-18A999)](#-免费是什么意思)
[![Local Tests](https://img.shields.io/badge/Local%20Smoke%20Tests-Passing-238636)](#-项目进度)

**[开始使用 ChatGPT 插件](docs/CHATGPT-QUICKSTART.md) · [Windows 安装](docs/INSTALL.md) · [English](docs/README.en.md) · [安全须知](docs/SECURITY.md)**

</div>

---

## ✨ 一句话介绍

**把你已有的 ChatGPT 使用额度变成远程编程工作流：手机提需求，本机做施工。**

你的 ChatGPT 负责理解需求和生成方案，MiceHole 负责连接真实 Windows 工程：读写文件、启动项目、等待进程、检查测试结果。**不需要再为 MiceHole 单独配置一个付费编程模型 API。**

> [!IMPORTANT]
> **作者现有的 MiceHole 远程部署已可从 ChatGPT 操作本机；GitHub Universal Preview 安装包当前只包含本地 MCP 执行层，还没有给普通用户交付完整的远程接入和账号授权方案。**
> 「免费 Codex」是产品愿景和体验类比：不需要购买 MiceHole 自己的模型 API。AI 客户端、套餐额度及自定义 MCP 写入权限仍有相应限制。MiceHole 不是 OpenAI Codex 官方产品。

## 🚀 你可以让 AI 做什么？

| 你提出的要求 | MiceHole 的执行能力 |
| :-- | :-- |
| “帮我看看项目哪里有问题” | 读取文件、全项目搜索、Git 状态 |
| “修复这个 Bug” | 文件写入、精确文本修改 |
| “启动项目，告诉我运行结果” | 命令执行、进程管理 |
| “运行测试，发现错误再修复” | 验证命令、退出码与输出 |
| “这个任务运行很久，完成后继续” | 启动、等待、读取长进程输出 |

**Universal 通用版不需要 Godot、Blender、Unity、ComfyUI 或 GPU。** 专用创作软件接口不作为必装组件。

## 🔄 工作原理

实线代表**Universal Preview 已验证的通用执行能力**，虚线代表**作者现有部署可演示、但 Universal 安装包尚未交付的远程手机接入**：

~~~mermaid
flowchart TB
    A["AI / MCP 客户端"] --> B["MiceHole Universal"]
    B --> C["Windows 工作区"]
    C --> D["修改文件"]
    C --> E["运行与等待进程"]
    C --> F["测试与 Git"]
    D --> G["将结果返回 AI"]
    E --> G
    F --> G
    G --> A
    H["手机 / 网页 ChatGPT（现有私有部署）"] -. "Universal 尚需远程接入与账号兼容" .-> B
    classDef core fill:#eef2ff,stroke:#7c8ef1,color:#24315a
    classDef local fill:#ecfdf5,stroke:#45ad81,color:#184e3c
    classDef future fill:#fff7ed,stroke:#e6a35f,color:#824714
    class A,B core
    class C,D,E,F,G local
    class H future
~~~

## 📱 ChatGPT 里怎么用？

在已完成授权、支持 MiceHole 工具调用的 ChatGPT 会话里，选择 MiceHole 插件（可用时通过 **@** 或输入框的 **+** 菜单），发出类似下面的指令：

> @MiceHole 在我已授权的工程目录里检查项目，修复网页在手机上布局错乱的问题。请直接修改本机代码、运行验证、检查错误，最后列出修改文件和真实测试结果。不要只贴代码。

**新用户先看 [ChatGPT 插件使用指南](docs/CHATGPT-QUICKSTART.md)。** 具体账号的插件安装、远程连接和写入权限，以 ChatGPT 实际支持为准。当前 Universal 下载包不是即装即用的手机远程插件。

## 🔐 使用你自己的 OpenAI Tunnel

**自托管远程接入预览已经开始提供：** 用户准备自己的 OpenAI Secure MCP Tunnel 与运行凭据后，安装包内置的**官方 tunnel-client** 会生成本机连接配置，让兼容的 ChatGPT 插件调用本机 MCP 工具。

**安全预览限制：远程目前只开放状态、读取、写入、补丁和搜索这 5 个工具。** 终端、测试执行、Git 命令和长进程暂时仅限本机；等 Tunnel 凭据与 AI 代码执行完成 Windows 身份隔离后再开放。

- **[自托管个人 Tunnel 安装指南](docs/SELF-HOSTED.md)**：内置官方客户端、个人 Tunnel 初始化、凭据保存、连接检查、在 ChatGPT 添加插件。
- **[ChatGPT 端使用指南](docs/CHATGPT-QUICKSTART.md)**：如何选择插件以及给出真正执行任务的指令。
- **MiceHole Control** 现可查看状态并由用户主动开启、停止、移除后台 Supervisor。模拟 Tunnel 崩溃→重启→恢复已通过测试，但全新 Windows 账户的开机自启、卸载及网络断线验收仍在进行。

> 重要：远程配置生成已通过隔离测试；新的真实账号首次连接、权限边界与手机端操作尚未验收。**不要将预览版当作已审核的远程执行安全产品。**

## 📦 下载与安装

| 发布文件 | 用途 | 状态 |
| :-- | :-- | :-- |
| **MiceHole-Universal-0.1.0-Setup.exe** | Windows x64 安装版 | 本机已编译；待安装及安全验收 |
| **MiceHole-Universal-0.1.0-Windows-x64.zip** | 便携版 | 本机已编译；待发布验收 |

审核完成后，将在 GitHub Releases 放置下载入口与 SHA256 校验文件。

快速上手：

1. 安装后运行 **scripts/doctor.cmd**，检查本机配置。
2. 阅读 [安全说明](docs/SECURITY.md)；执行命令默认关闭，必须主动开启。
3. 将要处理的工程放入配置中的工作区。
4. 在兼容本地 stdio MCP 的客户端中配置 **micehole.cmd**，详见 [连接指南](docs/CONNECT.md)。

## 💰 免费是什么意思？

- ✅ 不必为了 MiceHole 单独购买模型 API Key。
- ✅ 通用版不依赖专业创作软件和独立显卡。
- ⚠️ ChatGPT 本身可能需要订阅，模型额度并非无限。
- ⚠️ 普通 ChatGPT Free/Plus 及手机端的自定义 MCP 写入能力**不能保证可用**。
- ⚠️ 不代表已经具备 Codex 完整功能、同等性能或官方支持。

## 🧪 项目进度

| 验收项 | 状态 |
| :-- | :-- |
| MCP 初始化与工具发现 | ✅ 已测 |
| 文件读写 / 搜索 / 精确修改 | ✅ 已测 |
| 命令 / 验证 / Git | ✅ 已测 |
| 长进程启动、等待、输出 | ✅ 已测 |
| 基本越界路径与敏感路径拒绝 | ✅ 冒烟测试 |
| Windows 全新环境安装和卸载 | ⏳ 待测 |
| 独立安全审计 | ⏳ 待测 |
| 普通账号远程 ChatGPT 接入 | ⏳ 尚未实现 |
| 与 Codex 同任务测评 | ⏳ 待测 |

[查看完整测试与发布清单](docs/RELEASE.md)

## 📚 更多文档

[个人 Tunnel 自托管指南](docs/SELF-HOSTED.md) · [ChatGPT 端使用指南](docs/CHATGPT-QUICKSTART.md) · [插件介绍文案](docs/PLUGIN-LISTING.md) · [中文介绍](docs/README.zh-CN.md) · [English](docs/README.en.md) · [安装](docs/INSTALL.md) · [连接](docs/CONNECT.md) · [安全](docs/SECURITY.md) · [验收](docs/RELEASE.md)

---

<div align="center">

**MiceHole — From chat to real work.**

<sub>独立社区项目，与 OpenAI / Codex 无官方关联。早期 MiceHole 使用过 Desktop Commander 作为部分通用操作的执行后端；Universal Preview 是独立最小实现。命令执行不是沙盒，不应开放未经身份验证的公网端口。</sub>

</div>
