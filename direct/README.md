# MiceHole Direct V3 — portable high-privilege edition (engineering preview)

This is a portable snapshot of the author's actual Mouse Hole direct-stdio server with three specialized tools included: Godot, Blender and ComfyUI. The advertised MCP tools are status, read, write, patch, search, run, process, git, validate, browser, observe and GUI (15 total).

## Per-computer setup (Windows)
1. Install current Node.js; Python and a supported browser may be required by certain GUI/browser features.
2. Extract the package to a user-owned directory. Do not copy the author's original workspace or tokens.
3. Set MOUSE_HOLE_WORKSPACE to YOUR OWN project workspace; if unset, the launcher uses %USERPROFILE%\MiceHoleWorkspace.
4. In a **local stdio-capable MCP client**, point the executable at direct\micehole-direct.cmd. This starts in your Windows user context and can execute commands with that user's privileges. Never run the client elevated unless explicitly necessary.
5. For ChatGPT over the network, use your OWN separately provisioned, authenticated tunnel and ChatGPT private connector. **No hosted high-privilege remote setup has been certified by this snapshot.** Do not simply expose the stdio server or Windows command API on a public interface.
6. Each person's public IP, changing IP address, network proxy, tunnel ID, URL, machine name, user folder, and credentials must be configured per host. None should be hardcoded or shared.

## Important status
The previous public version provides a self-hosted tunnel restricted to file tools. Its remote-command restriction must NOT be removed without a separate protected Windows Worker and credential isolation. The direct server's high-privilege functionality has only been exercised on the developer computer and is not a security boundary.
