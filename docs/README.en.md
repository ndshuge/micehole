# MiceHole — Free Codex-like coding with your ChatGPT allowance

## Your ChatGPT quota. Your own Windows PC. Real coding from anywhere.

**Give instructions on your phone. Let your PC handle the code, build and tests.**

MiceHole is a Windows local execution layer for AI/MCP clients. Rather than only returning snippets, the assistant can read and edit real project files, run commands, inspect Git, run tests and wait for longer processes.

> **What “free Codex” means:** This is an easy-to-understand description of the experience we are building, **not an official free edition of OpenAI Codex**. MiceHole does not require a separate MiceHole model API subscription, but your AI client, model and ChatGPT entitlements still apply.

## Current availability

**Tested today:** standalone Windows x64 local stdio MCP server, with nine general-purpose tools (status, read, write, patch, search, run, process, git, validate).

**The owner's existing remote MiceHole deployment has demonstrated ChatGPT-to-Windows execution, including use from a phone.** The separate GitHub Universal installer does not yet deliver this remote onboarding for new customers, and full write access for ChatGPT accounts is subject to current official limitations. ChatGPT full custom MCP write support has its own plan/client restrictions. The ZIP and installer now include the official, hash-verified OpenAI tunnel-client and a personal Tunnel setup script. Independent new-user remote onboarding and credential security hardening have **not** passed release review.

## Architecture

- Compatible local MCP client
- MiceHole Universal (user-space Windows Node runtime)
- Configured workspace and approved command execution
- Files, Git, build tools and validation output returned to the AI

Use your own OpenAI Secure MCP Tunnel and a compatible ChatGPT plugin; the installer includes the official tunnel-client binary, but account authorization and Plugin setup are not automatic. Never expose a bare MCP command-execution endpoint to the public internet.

## Quick start

1. Once published, download the ZIP or installer from GitHub Releases.
2. Run **scripts/doctor.cmd**. Your private configuration lives outside the application directory.
3. Read [Security](SECURITY.md). Commands are disabled until you explicitly opt in.
4. For your own OpenAI Tunnel, follow [Personal Tunnel setup](SELF-HOSTED.md); the official client is already included.
5. Connect a compatible ChatGPT plugin or local MCP client and start in a disposable project.

Additional guides: [Use MiceHole in ChatGPT (Chinese)](CHATGPT-QUICKSTART.md), [Install](INSTALL.md), [Connect](CONNECT.md), [Release gates](RELEASE.md).

## Roadmap and trust

The Preview has passing local protocol and tool smoke tests, but has **not** passed a fresh-machine installation/security review, independent remote-user compatibility test or fair Codex comparison. Binary releases should be published only after these gates pass.

You do **not** need Godot, Blender, ComfyUI, Unity, a dedicated GPU or a project-specific integration.

This project is independent of and not endorsed by OpenAI. Earlier project prototypes used Desktop Commander as an execution backend for some general operations. The simplified Universal Preview contains a standalone core, which does not establish comparative performance.

The Universal Preview source is MIT-licensed; bundled Node.js, tunnel-client and Cloudflared components retain their own license and NOTICE files.
