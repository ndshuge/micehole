# Installation — Windows x64 preview

The Setup.exe bundles a Windows Node.js runtime, requiring no global Node installation.

1. Download from the eventual GitHub Release. Verify its published SHA256.
2. Install per user (no administrator elevation). Default: %LOCALAPPDATA%\Programs\MiceHole.
3. In the installation folder, run scripts\doctor.cmd.
4. Read SECURITY.md. Execute scripts\enable-execution.ps1 in PowerShell and type ENABLE if you want build/test commands.
5. Point a compatible local MCP client to the absolute path of micehole.cmd. See CONNECT.md.
6. Put a disposable project under %USERPROFILE%\MiceHoleWorkspace (or change workspace in %LOCALAPPDATA%\MiceHole\config.json).

The installer does not silently enable a public tunnel or run a permanent background daemon.

To disable command execution: run scripts\disable-execution.ps1.

Use Windows Installed Apps to uninstall. The user workspace and configuration remain on disk.

Troubleshooting: If a command is rejected as disabled, opt in explicitly; if a path is rejected, make sure it is inside the configured workspace; if a process ID is unknown, the MCP server may have restarted. Bundled Node does not bundle npm or Git, so those tools must be installed separately for projects needing them.
