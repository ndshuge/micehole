# MiceHole Universal v0.1.0 Beta

**Your Windows PC. Your own ChatGPT and Secure MCP Tunnel.**

[Downloads](https://github.com/ndshuge/micehole/releases) · [Install](INSTALL.md) · [Tunnel setup](SELF-HOSTED.md) · [Security](SECURITY.md) · [Main README](../README.md)

This is an independent, **early public preview**—not official Codex, a free
ChatGPT subscription or a complete remote coding automation system.

## What works today

| Capability | Local stdio MCP | Personal Tunnel in ChatGPT |
| --- | --- | --- |
| Status and workspace file read/search | Yes | Yes |
| Workspace file write/precise patch | Yes | Yes |
| Run/validate/Git/process tools | Explicit local opt-in only; **not sandboxed** | **Disabled** |
| Autonomous edit→run→test→fix loop | Depends on local client and opt-in | **Not supported** |
| Custom private ChatGPT plugin eligibility | Not applicable | Account/workspace/client-dependent; not verified for an independent user |

The installed app includes a verified copy of the official OpenAI
`tunnel-client`, a local Node runtime, configuration scripts, Doctor and
optional opt-in background recovery. Setup needs **your own** OpenAI Platform
Tunnel ID and runtime credential; do not paste secrets into ChatGPT or GitHub.

## First steps

1. Download unsigned Windows x64 Setup.exe or portable ZIP plus SHA256SUMS.txt
   from the [v0.1.0 beta Release](https://github.com/ndshuge/micehole/releases).
2. Compare SHA256 checksums, install as your current user, run Doctor, and
   choose a disposable approved workspace.
3. Use [CONNECT](CONNECT.md) for compatible local stdio MCP clients, or
   [SELF-HOSTED](SELF-HOSTED.md) for personal ChatGPT Tunnel initialization.
4. Start the Tunnel in the foreground, verify status, then try status/read/
   write/patch/search in a test workspace if your account permits it.

**Caveats:** no full remote shell; independent ChatGPT user pairing, real
reboot/sleep recovery, signed installer, external security audit and
upgrade/rollback have not been completed. Do not bypass Windows security
warnings or expose a raw MCP port to the public Internet.

[Development evidence](DEVLOG.md) · [Known blockers](RELEASE.md).
MIT project source; Node and tunnel-client retain third-party licenses.
