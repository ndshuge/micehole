<div align="center">

# MiceHole

### 把 ChatGPT 变成你的免费 Codex 式编程助手

**Say it in ChatGPT. Build it on your PC.**

让 AI 不只给出代码，还能在电脑上修改文件、运行项目、检查错误、继续施工。

[![Windows](https://img.shields.io/badge/Windows-10%20%2F%2011-0078D4?logo=windows&logoColor=white)](#-下载与安装)
[![MCP](https://img.shields.io/badge/Protocol-MCP-6C57DD)](#-工作原理)
[![Release](https://img.shields.io/badge/Release-v0.1.0%20Preview-orange)](#-项目进度)
[![No MiceHole API](https://img.shields.io/badge/MiceHole%20API%20Key-Not%20Required-18A999)](#-免费是什么意思)
[![Local Tests](https://img.shields.io/badge/Local%20Smoke%20Tests-Passing-238636)](#-项目进度)

**[中文](docs/README.zh-CN.md) · [English](docs/README.en.md) · [安装](docs/INSTALL.md) · [安全](docs/SECURITY.md)**

</div>

---

## ✨ 一句话介绍

**MiceHole = ChatGPT 的对话体验 + 真实电脑的开发执行能力。**

让兼容 MCP 的 AI 助手查看工程、修改代码、运行构建、等待长进程结束并读取测试结果，而不是在聊天和终端之间反复复制粘贴。

> [!IMPORTANT]
> **当前仅提供已经实测的本地 MCP 执行引擎 Preview，并非所有 ChatGPT 账号都能直接使用的远程一键版。**
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

实线代表**本机已测试链路**，虚线是**仍需完成的远程 ChatGPT 接入**：

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
    H["手机 / 网页 ChatGPT（目标）"] -. "受支持的账号 + 安全远程连接" .-> B
    classDef core fill:#eef2ff,stroke:#7c8ef1,color:#24315a
    classDef local fill:#ecfdf5,stroke:#45ad81,color:#184e3c
    classDef future fill:#fff7ed,stroke:#e6a35f,color:#824714
    class A,B core
    class C,D,E,F,G local
    class H future
~~~

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

[中文介绍](docs/README.zh-CN.md) · [English](docs/README.en.md) · [安装](docs/INSTALL.md) · [连接](docs/CONNECT.md) · [安全](docs/SECURITY.md) · [验收](docs/RELEASE.md)

---

<div align="center">

**MiceHole — From chat to real work.**

<sub>独立社区项目，与 OpenAI / Codex 无官方关联。早期 MiceHole 使用过 Desktop Commander 作为部分通用操作的执行后端；Universal Preview 是独立最小实现。命令执行不是沙盒，不应开放未经身份验证的公网端口。</sub>

</div>
