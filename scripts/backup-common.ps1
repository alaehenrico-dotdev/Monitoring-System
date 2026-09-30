# Shared helpers for backup.ps1 / restore.ps1 / install-backup-task.ps1.
# Dot-source this file; it does nothing on its own.

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $RepoRoot "server\.env"

# Where backups live. Override with the BACKUP_DIR environment variable (or
# -BackupDir on backup.ps1). Keep it OFF the drive the database lives on if
# you can - a backup on the same disk doesn't survive that disk dying.
function Get-BackupDir {
    if ($env:BACKUP_DIR) { return $env:BACKUP_DIR }
    return "C:\ala-eh-backups"
}

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $line = "{0} [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
    Write-Host $line
    try {
        $dir = Get-BackupDir
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        Add-Content -Path (Join-Path $dir "backup.log") -Value $line -Encoding UTF8
    } catch {
        # Logging must never be the thing that breaks a backup.
    }
}

# Reads DATABASE_URL from server\.env (same source the API uses) so there is
# no second copy of the credentials to keep in sync or leak.
function Get-DbConfig {
    if ($env:DATABASE_URL) { $url = $env:DATABASE_URL }
    else {
        if (-not (Test-Path $EnvFile)) { throw "server\.env not found at $EnvFile and DATABASE_URL is not set." }
        $match = Select-String -Path $EnvFile -Pattern '^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?' | Select-Object -First 1
        if (-not $match) { throw "DATABASE_URL is not set in $EnvFile." }
        $url = $match.Matches[0].Groups[1].Value.Trim()
    }
    $uri = [System.Uri]$url
    $userInfo = $uri.UserInfo.Split(":", 2)
    $password = ""
    if ($userInfo.Length -gt 1) { $password = [System.Uri]::UnescapeDataString($userInfo[1]) }
    $port = 3306
    if ($uri.Port -gt 0) { $port = $uri.Port }
    return @{
        Host     = $uri.Host
        Port     = $port
        User     = [System.Uri]::UnescapeDataString($userInfo[0])
        Password = $password
        Database = $uri.AbsolutePath.TrimStart("/")
    }
}

# Finds mysqldump / mysql: MYSQLDUMP_PATH (same setting the app uses), then
# PATH, then the usual XAMPP location.
function Find-MySqlTool {
    param([ValidateSet("mysqldump", "mysql")][string]$Name)
    $candidates = @()
    if ($env:MYSQLDUMP_PATH) { $candidates += (Join-Path (Split-Path $env:MYSQLDUMP_PATH -Parent) "$Name.exe") }
    elseif (Test-Path $EnvFile) {
        $m = Select-String -Path $EnvFile -Pattern '^\s*MYSQLDUMP_PATH\s*=\s*"?([^"\r\n]+)"?' | Select-Object -First 1
        if ($m) { $candidates += (Join-Path (Split-Path $m.Matches[0].Groups[1].Value.Trim() -Parent) "$Name.exe") }
    }
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) { $candidates += $cmd.Source }
    $candidates += "C:\xampp\mysql\bin\$Name.exe"
    foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
    throw "$Name.exe not found. Set MYSQLDUMP_PATH in server\.env (or install the MySQL client tools)."
}

# Backups contain every account and all stock data - lock the folder to the
# current user, SYSTEM and Administrators (no inherited "Users" read access).
function Protect-BackupDir {
    param([string]$Dir)
    try {
        & icacls $Dir /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null
    } catch {
        Write-Log "Could not tighten permissions on $Dir : $_" "WARN"
    }
}

# Starts a client process with the password passed via MYSQL_PWD (visible only
# to that child, never on the command line where `tasklist`/`Get-Process`
# could show it).
function Start-MySqlProcess {
    param([string]$Exe, [string[]]$Arguments, $Db, [bool]$RedirectIn = $false)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Exe
    $psi.Arguments = ($Arguments | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join " "
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = -not $RedirectIn
    $psi.RedirectStandardInput = $RedirectIn
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $psi.EnvironmentVariables["MYSQL_PWD"] = $Db.Password
    return [System.Diagnostics.Process]::Start($psi)
}

# Confirms a .sql.gz is a complete, readable mysqldump: gunzips the whole
# stream, checks the mysqldump header, and the "Dump completed" trailer that
# mysqldump only writes on success (a truncated dump lacks it).
function Test-DumpFile {
    param([string]$Path)
    $fs = [System.IO.File]::OpenRead($Path)
    try {
        $gz = New-Object System.IO.Compression.GZipStream($fs, [System.IO.Compression.CompressionMode]::Decompress)
        $reader = New-Object System.IO.StreamReader($gz, [System.Text.Encoding]::UTF8)
        $first = $reader.ReadLine()
        if ($first -notmatch '^-- (MySQL|MariaDB) dump') { return $false }
        $tail = ""
        while ($null -ne ($line = $reader.ReadLine())) {
            if ($line.StartsWith("-- Dump completed")) { $tail = $line }
        }
        return [bool]$tail
    } catch {
        return $false
    } finally {
        $fs.Dispose()
    }
}
