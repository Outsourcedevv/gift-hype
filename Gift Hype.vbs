' Opens Unbound as an app, with no black window.
' The first time (or if Node.js is missing) it runs Setup.bat first.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir

needSetup = Not fso.FolderExists(dir & "\node_modules")
If sh.Run("cmd /c where node >nul 2>nul", 0, True) <> 0 Then needSetup = True
If needSetup Then
    sh.Run """" & dir & "\Setup.bat"" nopause", 1, True
    If sh.Run("cmd /c where node >nul 2>nul", 0, True) <> 0 Then
        MsgBox "Unbound needs Node.js. Run Setup.bat in the Unbound folder, then open Unbound again.", 48, "Unbound"
        WScript.Quit
    End If
End If

If Not fso.FolderExists(dir & "\data") Then fso.CreateFolder(dir & "\data")
sh.Run "cmd /c node server.js > ""data\app.log"" 2>&1", 0, False
