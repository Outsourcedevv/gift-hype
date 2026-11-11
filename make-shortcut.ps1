# Puts a "Gift Hype" icon on the desktop that opens the app.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktop = [Environment]::GetFolderPath('Desktop')
$s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop 'Gift Hype.lnk'))
$s.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$s.Arguments = '"' + (Join-Path $here 'Gift Hype.vbs') + '"'
$s.WorkingDirectory = $here
$s.IconLocation = (Join-Path $here 'icon.ico') + ',0'
$s.Description = 'Gift Hype: TikTok gifts make things happen in your games'
$s.Save()
