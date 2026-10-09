# MiceHole Universal — English overview

## Free Codex-like coding experience, directly from an AI chat

**Chat to code. Code to execution. Execution back to chat.**

MiceHole is a Windows local execution layer for AI/MCP clients. Rather than only returning snippets, the assistant can read and edit real project files, run commands, inspect Git, run tests and wait for longer processes.

> **What “free Codex” means:** This is an easy-to-understand description of the experience we are building, **not an official free edition of OpenAI Codex**. MiceHole does not require a separate MiceHole model API subscription, but your AI client, model and ChatGPT entitlements still apply.

## Current availability

**Tested today:** standalone Windows x64 local stdio MCP server, with nine general-purpose tools (status, read, write, patch, search, run, process, git, validate).

**Not yet generally available:** one-click remote ChatGPT integration for regular Free/Plus accounts or ChatGPT mobile. ChatGPT full custom MCP write support has its own plan/client restrictions. A secure remote relay and complete outside-user onboarding are not bundled in this preview.

## Architecture

- Compatible local MCP client
- MiceHole Universal (user-space Windows Node runtime)
- Configured workspace and approved command execution
- Files, Git, build tools and validation output returned to the AI

The future remote product goal adds a secure, authenticated bridge from an eligible ChatGPT account. Never expose a bare MCP command-execution endpoint to the public internet.

## Quick start

1. Once published, download the ZIP or installer from GitHub Releases.
2. Run **scripts/doctor.cmd**. Your private configuration lives outside the application directory.
3. Read [Security](SECURITY.md). Commands are disabled until you explicitly opt in.
4. Set up a compatible MCP client's local stdio command to the installed **micehole.cmd**.
5. Use a disposable project in your configured workspace for the first trial.

Additional guides: [Install](INSTALL.md), [Connect](CONNECT.md), [Release gates](RELEASE.md).

## Roadmap and trust

The Preview has passing local protocol and tool smoke tests, but has **not** passed a fresh-machine installation/security review, independent remote-user compatibility test or fair Codex comparison. Binary releases should be published only after these gates pass.

You do **not** need Godot, Blender, ComfyUI, Unity, a dedicated GPU or a project-specific integration.

This project is independent of and not endorsed by OpenAI. Earlier project prototypes used Desktop Commander as an execution backend for some general operations. The simplified Universal Preview contains a standalone core, which does not establish comparative performance.

The project license will be selected before a public release.
