# Windows installation · MiceHole v0.1.0 Beta

**Early public preview:** supports local MCP, and an experimental personal
Secure MCP Tunnel with **five file/status tools only**. Remote shell, Git,
processes and build/test execution are NOT available in the first beta.

## Download and verify

Get the **Setup.exe** or **Windows-x64.zip** plus `SHA256SUMS.txt` from
[GitHub Releases](https://github.com/ndshuge/micehole/releases).
Verify checksums before running downloaded software:

```powershell
Get-FileHash .\MiceHole-Universal-0.1.0-Setup.exe -Algorithm SHA256
Get-FileHash .\MiceHole-Universal-0.1.0-Windows-x64.zip -Algorithm SHA256
```

Compare each value to the matching filename in `SHA256SUMS.txt`.
The installer is **not code-signed**; SmartScreen may warn. Do not disable
Microsoft Defender or your organization's policies.

## Install

1. On Windows x64, launch the per-user installer. It does not need administrator
   privileges by default and installs under `%LOCALAPPDATA%\Programs\MiceHole`.
   Portable users can extract the ZIP to a new folder instead.
2. Run **MiceHole Doctor** via the Start menu (or `scripts\doctor.cmd`).
3. Review the default project folder `%USERPROFILE%\MiceHoleWorkspace`; use only
   a disposable/explicitly approved workspace for initial tests.
4. For a **local MCP client**, configure `micehole.cmd`; see [CONNECT.md](CONNECT.md).
   Local terminal commands remain disabled until the user deliberately opts in,
   and are **not** OS-isolated or limited by the file workspace guard.
5. For your **own ChatGPT private Tunnel**, follow [SELF-HOSTED.md](SELF-HOSTED.md).
   The official tunnel-client is bundled, but you still need your own OpenAI
   Platform Tunnel ID, runtime key and a compatible ChatGPT workspace/account.
   First run it in a visible foreground terminal and inspect Doctor before
   enabling any optional background task.

The EXE does **not** grant ChatGPT permissions or install a ChatGPT plugin.
No default background service, Windows Worker account or public network listener
is created automatically.

## Stop, revoke and uninstall

1. Close the foreground Tunnel window or use **MiceHole Control → Stop background**
   and **Remove autostart** if you explicitly enabled background recovery.
2. Revoke the personal Tunnel runtime key in your OpenAI Platform account and
   remove the private MCP plugin in ChatGPT when you no longer want access.
3. Uninstall **MiceHole Universal** from Windows Installed Apps. The uninstall
   hook requests removal of MiceHole's **own** personal scheduled task.
4. Your personal project and `%LOCALAPPDATA%\MiceHole` configuration may remain.
   To fully wipe this product's local configuration, first back up any data
   you want to keep, then manually inspect and remove only the MiceHole-owned
   settings/profile/DPAPI key under that directory. Do not remove other
   applications' data or attempt to alter OpenAI account credentials elsewhere.

## Troubleshooting

- Run `scripts\remote-doctor.ps1 -ConfigurationOnly` before starting a Tunnel.
- The remote MCP tool list intentionally lacks run, Git, process and validate.
- If your ChatGPT account cannot add a custom private MCP plugin or call write
  tools, that is an eligibility/client issue, not fixed by opening a Windows port.
- Real fresh-user ChatGPT pairing, true reboot/sleep recovery, upgrade/rollback
  and independent security audit are pending. Report failures without secrets.

[Security policy](SECURITY.md) · [Beta scope](RELEASE.md)
