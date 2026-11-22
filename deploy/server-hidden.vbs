' Runs start-server.bat with no visible window
Set sh = CreateObject("WScript.Shell")
sh.Run "cmd /c """ & CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\start-server.bat""", 0, False
