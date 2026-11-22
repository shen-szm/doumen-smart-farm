' Runs tunnel.ps1 with no visible window (double-click friendly)
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -File """ & CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\tunnel.ps1""", 0, False
