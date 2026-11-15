# Puts an "Unbound" icon on the desktop that opens the app (and takes away the old "Gift Hype" one).
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktop = [Environment]::GetFolderPath('Desktop')
$sh = New-Object -ComObject WScript.Shell
$old = Join-Path $desktop 'Gift Hype.lnk'
if (Test-Path $old) { if ($sh.CreateShortcut($old).Arguments -like ('*' + $here + '*')) { Remove-Item $old -Force } }
$s = $sh.CreateShortcut((Join-Path $desktop 'Unbound.lnk'))
$s.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$s.Arguments = '"' + (Join-Path $here 'Gift Hype.vbs') + '"'
$s.WorkingDirectory = $here
$s.IconLocation = (Join-Path $here 'icon.ico') + ',0'
$s.Description = 'Unbound: TikTok gifts with no limits - sounds, popups and actions in your games'
$s.Save()
