<#
.SYNOPSIS
  Restores the database from a .sql.gz made by backup.ps1 (or a plain .sql
  from the app's Download Backup button).

.DESCRIPTION
  Verifies the file, takes a safety snapshot of the CURRENT database first
  (unless -SkipSafetySnapshot), then asks you to type RESTORE before replacing
  anything. Stop the API first so nothing writes mid-restore:
      pm2 stop ala-eh-api
  ...and start it again afterwards:
      pm2 start ala-eh-api

.PARAMETER File
  Path to the backup. Use -List to see what's available.

.PARAMETER Database
  Restore into a different database instead of the one in DATABASE_URL (it is
  created if missing) - handy for a dry run: -Database ala_eh_restore_test

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\restore.ps1 -List
  powershell -ExecutionPolicy Bypass -File scripts\restore.ps1 -File C:\ala-eh-backups\daily\db_backup_2026-09-30_020000.sql.gz
#>
param(
    [string]$File,
    [string]$Database,
    [switch]$List,
    [switch]$SkipSafetySnapshot,
    [switch]$Force
)

. "$PSScriptRoot\backup-common.ps1"

try {
    $root = Get-BackupDir
    if ($List -or -not $File) {
        Write-Host "Available backups under $root :"
        Get-ChildItem $root -Recurse -Filter "db_backup_*.sql.gz" -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending |
            ForEach-Object { "{0,-22} {1,10:N0} KB  {2}" -f $_.LastWriteTime.ToString("yyyy-MM-dd HH:mm"), ($_.Length / 1KB), $_.FullName }
        if (-not $File) { exit 0 }
    }
    if (-not (Test-Path $File)) { throw "File not found: $File" }

    $db = Get-DbConfig
    $target = $db.Database
    if ($Database) { $target = $Database }
    $mysqlExe = Find-MySqlTool "mysql"
    $isGz = $File.EndsWith(".gz")

    if ($isGz) {
        Write-Log "Verifying $File ..."
        if (-not (Test-DumpFile $File)) { throw "Verification failed - not a complete mysqldump backup. Nothing was changed." }
    }

    if (-not $Force) {
        Write-Host ""
        Write-Host "This will REPLACE all data in database '$target' on $($db.Host) with:" -ForegroundColor Yellow
        Write-Host "  $File"
        if ((Read-Host "Type RESTORE to continue") -ne "RESTORE") { Write-Host "Cancelled."; exit 0 }
    }

    if (-not $SkipSafetySnapshot -and -not $Database) {
        Write-Log "Taking a safety snapshot of the current database first ..."
        & powershell -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\backup.ps1" -Mode snapshot -Label "pre-restore"
        if ($LASTEXITCODE -ne 0) { throw "Safety snapshot failed - restore aborted. (Use -SkipSafetySnapshot to override.)" }
    }

    if ($Database) {
        $create = Start-MySqlProcess -Exe $mysqlExe -Db $db -Arguments @("--host", $db.Host, "--port", $db.Port, "--user", $db.User, "-e", "CREATE DATABASE IF NOT EXISTS ``$target``")
        $create.WaitForExit()
        if ($create.ExitCode -ne 0) { throw "Could not create database $target : $($create.StandardError.ReadToEnd())" }
    }

    Write-Log "Restoring into '$target' ..."
    $proc = Start-MySqlProcess -Exe $mysqlExe -Db $db -RedirectIn $true -Arguments @("--host", $db.Host, "--port", $db.Port, "--user", $db.User, $target)
    $errTask = $proc.StandardError.ReadToEndAsync()
    $fs = [System.IO.File]::OpenRead($File)
    try {
        $src = $fs
        if ($isGz) { $src = New-Object System.IO.Compression.GZipStream($fs, [System.IO.Compression.CompressionMode]::Decompress) }
        $src.CopyTo($proc.StandardInput.BaseStream)
        $proc.StandardInput.Close()
    } finally {
        $fs.Dispose()
    }
    $proc.WaitForExit()
    if ($proc.ExitCode -ne 0) { throw "mysql exited with code $($proc.ExitCode): $($errTask.Result.Trim())" }

    Write-Log "Restore OK: '$target' now matches $File"
    if (-not $Database) { Write-Host "Start the API again if you stopped it:  pm2 start ala-eh-api" }
    exit 0
} catch {
    Write-Log "Restore FAILED: $_" "ERROR"
    exit 1
}
