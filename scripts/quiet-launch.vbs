Option Explicit
Dim shell, script, command
If WScript.Arguments.Count <> 1 Then WScript.Quit 2
script = WScript.Arguments(0)
If InStr(script, Chr(34)) > 0 Then WScript.Quit 2
Set shell = CreateObject("WScript.Shell")
command = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & script & Chr(34)
shell.Run command, 0, False
