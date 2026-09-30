<#
.SYNOPSIS
  Compressed, verified local database backup with retention. (This app has no
  user-uploaded files - stock data lives entirely in MySQL - so there is no
  separate files archive.)

.PARAMETER Mode
  daily     (default) - timestamped dump in <BackupDir>\daily, then purge dumps
            older than -RetentionDays (always keeping the newest one).
  snapshot  - quick dump into <BackupDir>\snapshots, meant to be run before a
            schema migration or an update (`npm run backup:snapshot`). Kept
            separately so the daily purge never eats it; only the newest
            -KeepSnapshots are retained.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\backup.ps1
  powershell -ExecutionPolicy Bypass -File scripts\backup.ps1 -Mode snapshot -Label pre-migration
#>
param(
    [ValidateSet("daily", "snapshot")][string]$Mode = "daily",
    [string]$BackupDir,
    [int]$RetentionDays = 7,
    [int]$KeepSnapshots = 10,
    [string]$Label = "",
    # Refuse to start with less free space than this (MB) - or than 3x the
    # previous dump, whichever is larger.
    [int]$MinFreeMB = 500
)

. "$PSScriptRoot\backup-common.ps1"
if ($BackupDir) { $env:BACKUP_DIR = $BackupDir }

$root = Get-BackupDir
$sub = "daily"
if ($Mode -eq "snapshot") { $sub = "snapshots" }
$targetDir = Join-Path $root $sub
$partial = $null

try {
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    Protect-BackupDir $root

    $db = Get-DbConfig
    $dumpExe = Find-MySqlTool "mysqldump"

    # --- disk space safety check --------------------------------------------
    $drive = Get-PSDrive -Name ((Get-Item $targetDir).PSDrive.Name)
    $freeMB = [math]::Floor($drive.Free / 1MB)
    $last = Get-ChildItem $targetDir -Filter "*.sql.gz" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $needMB = $MinFreeMB
    if ($last) { $needMB = [math]::Max($MinFreeMB, [math]::Ceiling(3 * $last.Length / 1MB)) }
    if ($freeMB -lt $needMB) { throw "Not enough disk space on $($drive.Name): ($freeMB MB free, need $needMB MB). Nothing was written." }

    $stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
    $name = "db_backup_$stamp"
    if ($Label) { $name += "_" + ($Label -replace '[^A-Za-z0-9_-]', '') }
    $final = Join-Path $targetDir "$name.sql.gz"
    $partial = "$final.partial"

    Write-Log "Starting $Mode backup of '$($db.Database)' -> $final"

    # --- dump, gzip on the fly ----------------------------------------------
    # Written to *.partial and only renamed once verified, so a half-written
    # file can never be mistaken for a good backup (or be what retention keeps).
    $args = @("--host", $db.Host, "--port", $db.Port, "--user", $db.User,
        "--single-transaction", "--routines", "--triggers", "--no-tablespaces", $db.Database)
    $proc = Start-MySqlProcess -Exe $dumpExe -Arguments $args -Db $db
    $errTask = $proc.StandardError.ReadToEndAsync()
    $out = [System.IO.File]::Create($partial)
    try {
        $gz = New-Object System.IO.Compression.GZipStream($out, [System.IO.Compression.CompressionMode]::Compress)
        $proc.StandardOutput.BaseStream.CopyTo($gz)
        $gz.Dispose()
    } finally {
        $out.Dispose()
    }
    $proc.WaitForExit()
    if ($proc.ExitCode -ne 0) { throw "mysqldump exited with code $($proc.ExitCode): $($errTask.Result.Trim())" }

    if (-not (Test-DumpFile $partial)) { throw "Verification failed - the dump is incomplete or unreadable. Discarded." }
    Move-Item -Path $partial -Destination $final
    $partial = $null
    $sizeKB = [math]::Round((Get-Item $final).Length / 1KB, 1)
    Write-Log "Backup OK: $final ($sizeKB KB, verified)"

    # --- retention ------------------------------------------------------------
    $all = Get-ChildItem $targetDir -Filter "db_backup_*.sql.gz" | Sort-Object LastWriteTime -Descending
    if ($Mode -eq "daily") {
        $cutoff = (Get-Date).AddDays(-$RetentionDays)
        # Never delete the newest backup, whatever its age.
        $old = $all | Select-Object -Skip 1 | Where-Object { $_.LastWriteTime -lt $cutoff }
    } else {
        $old = $all | Select-Object -Skip $KeepSnapshots
    }
    foreach ($f in $old) {
        Remove-Item $f.FullName -Force
        Write-Log "Purged old backup: $($f.Name)"
    }
    # Leftovers from a run that was killed mid-dump.
    Get-ChildItem $targetDir -Filter "*.partial" -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddHours(-6) } | Remove-Item -Force
    exit 0
} catch {
    if ($partial -and (Test-Path $partial)) { Remove-Item $partial -Force -ErrorAction SilentlyContinue }
    Write-Log "Backup FAILED: $_" "ERROR"
    exit 1
}
