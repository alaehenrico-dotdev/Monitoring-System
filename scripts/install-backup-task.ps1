<#
.SYNOPSIS
  Registers a Windows Scheduled Task that runs scripts\backup.ps1 every night
  at 02:00 (the Windows equivalent of a 2 AM crontab entry).

  Run once from an elevated (Administrator) PowerShell:
      powershell -ExecutionPolicy Bypass -File scripts\install-backup-task.ps1
  Remove with:  Unregister-ScheduledTask -TaskName AlaEhDbBackup -Confirm:$false
#>
param(
    [string]$Time = "02:00",
    [string]$TaskName = "AlaEhDbBackup"
)

$script = Join-Path $PSScriptRoot "backup.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
# StartWhenAvailable: if the machine was off at 02:00, run as soon as it's back.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
# Runs as SYSTEM so it works with nobody logged in; SYSTEM can read server\.env
# only if the repo's ACL allows it - if the task logs "server\.env not found",
# register it under your own account instead (-User / -Password).
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Scheduled '$TaskName' daily at $Time. Test it now with:  Start-ScheduledTask -TaskName $TaskName"
