<#
.SYNOPSIS
    Install the workspace dsh-btw package into a MIRROR harness home and boot it
    on a spare port, without touching the live company profile.

.DESCRIPTION
    Reuses the 0.2.1 rehearsal mirror built by .harness-check\rehearse-021.ps1:
      1. patch    - add the `link:` dependency + `dsh-btw` bundle entry to the
                    mirror profile's package.json (what plugin_manager does),
                    and junction the package into the mirror node_modules
      2. compose  - `--profile web --dump-config` exits 0, the btw row resolves,
                    and the loader prints no complaint
      3. serve    - cold boot on a spare port; waits for the listener and prints
                    the launch URL

    Run the rehearsal first if the mirror is missing:
      powershell -NoProfile -ExecutionPolicy Bypass -File .harness-check\rehearse-021.ps1

    Run with:
      powershell -NoProfile -ExecutionPolicy Bypass -File dsh-btw\test\e2e\build-mirror-plugin.ps1 -KeepRunning

.PARAMETER KeepRunning
    Leave the mirror server up (the E2E script needs it); prints the PID and URL.
#>
param(
    [string] $RepoRoot     = 'C:\Users\Andrew\Desktop\dsh_andrew',
    [string] $MirrorHome   = 'C:\Users\Andrew\Desktop\dsh_andrew\.harness-check\home-021',
    [string] $PluginDir    = 'C:\Users\Andrew\Desktop\dsh_andrew\dsh-btw',
    [string] $ScratchPrefix= 'C:\Users\Andrew\Desktop\dsh_andrew\.harness-check\prefix-021',
    [string] $CredentialsFrom = "$env:USERPROFILE\.dsh-company\.credentials.yaml",
    [int]    $Port         = 3164,
    [switch] $KeepRunning
)

$ErrorActionPreference = 'Stop'
$Check = Join-Path $RepoRoot '.harness-check'
$Cli = Join-Path $ScratchPrefix 'node_modules\@deepseek-ai\dsh\lib\bin.js'
$ProfileDir = Join-Path $MirrorHome 'profiles\web'
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$DumpLog = Join-Path $Check "dump-btw-$Stamp.txt"
$DumpErr = Join-Path $Check "dump-btw-$Stamp.err.txt"
$BootLog = Join-Path $Check "boot-btw-$Stamp.log"
$RuntimeFile = Join-Path $Check 'btw-mirror-runtime.json'

function Die($m) { Write-Host "    FAIL  $m" -ForegroundColor Red; exit 1 }
function Ok($m)  { Write-Host "    OK    $m" -ForegroundColor Green }
function Info($m){ Write-Host "    ..    $m" -ForegroundColor Gray }

if (-not (Test-Path -LiteralPath $Cli)) { Die "scratch CLI not found: $Cli (run rehearse-021.ps1 first)" }
if (-not (Test-Path -LiteralPath (Join-Path $ProfileDir 'package.json'))) { Die "mirror profile not found: $ProfileDir (run rehearse-021.ps1 first)" }
if (-not (Test-Path -LiteralPath (Join-Path $PluginDir 'package.json'))) { Die "plugin package not found: $PluginDir" }
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { Die "port $Port is already in use" }

Write-Host ''
Write-Host "mirror install: $PluginDir -> $ProfileDir on port $Port"

# --- 0. credentials --------------------------------------------------------
# The mirror home is copied from the live home, but the credential store can be
# stale or absent; without a provider key every side answer is an error overlay.
if (Test-Path -LiteralPath $CredentialsFrom) {
    Copy-Item -LiteralPath $CredentialsFrom -Destination (Join-Path $MirrorHome '.credentials.yaml') -Force
    Ok "provider credentials copied from $CredentialsFrom"
} else {
    Info "no credential store at $CredentialsFrom - only error-overlay paths will work"
}

# --- 1. patch the mirror profile (same effect as plugin_manager) ------------
$patcher = Join-Path $PluginDir 'test\e2e\patch-mirror-profile.mjs'
cmd /c "node `"$patcher`" `"$ProfileDir`" `"$PluginDir`" > `"$Check\patch-btw-$Stamp.log`" 2>&1"
if ($LASTEXITCODE -ne 0) { Get-Content (Join-Path $Check "patch-btw-$Stamp.log") -Tail 20 | ForEach-Object { Info $_ }; Die 'mirror profile patch failed' }
Ok 'mirror profile package.json patched'

$link = Join-Path $ProfileDir 'node_modules\dsh-btw'
if (Test-Path -LiteralPath $link) { cmd /c "rmdir `"$link`"" | Out-Null }
cmd /c "mklink /J `"$link`" `"$PluginDir`" > `"$Check\mklink-btw-$Stamp.log`" 2>&1"
if ($LASTEXITCODE -ne 0) { Get-Content (Join-Path $Check "mklink-btw-$Stamp.log") -Tail 5 | ForEach-Object { Info $_ }; Die 'junction creation failed' }
Ok "junction: $link -> $PluginDir"

# --- 2. compose -------------------------------------------------------------
$env:DSH_HOME = $MirrorHome
cmd /c "node `"$Cli`" --profile web --dump-config > `"$DumpLog`" 2> `"$DumpErr`""
if ($LASTEXITCODE -ne 0) {
    Get-Content -LiteralPath $DumpErr -ErrorAction SilentlyContinue | Select-Object -First 25 | ForEach-Object { Info $_ }
    Die "composition failed (exit $LASTEXITCODE) - see $DumpErr"
}
$dump = Get-Content -LiteralPath $DumpLog
Ok "composition exit 0, $($dump.Count) lines -> $DumpLog"
$row = $dump | Select-String -Pattern "^\s*-?\s*id:\s*'?btw'?\s*$"
if ($row.Count -lt 1) { Die 'the btw row is MISSING from the composed config' }
Ok 'entry present: btw'
$nameRow = $dump | Select-String -Pattern "name:\s*'?dsh-btw'?\s*$"
if ($nameRow.Count -lt 1) { Die 'the btw row does not resolve to dsh-btw' }
Ok 'entry resolves: dsh-btw'
$problems = @()
foreach ($pattern in 'not found', 'unknown key', 'cannot resolve', 'did not activate', 'is not a function', 'undefined is not') {
    $hits = $dump | Select-String -Pattern $pattern -SimpleMatch
    foreach ($h in $hits) { $problems += $h.Line.Trim() }
}
if ($problems.Count -gt 0) { foreach ($p in ($problems | Select-Object -Unique)) { Die "composed config complains: $p" } }
Ok 'no loader complaint'

# --- 3. cold boot -----------------------------------------------------------
Info 'starting a cold mirror boot (1-3 minutes is normal)'
$null = New-Item -ItemType Directory -Force -Path (Join-Path $MirrorHome 'logs')
$proc = Start-Process -FilePath 'node' -ArgumentList @("`"$Cli`"", 'web', '--port', "$Port") `
    -NoNewWindow -PassThru -RedirectStandardOutput $BootLog -RedirectStandardError "$BootLog.err"

$deadline = (Get-Date).AddSeconds(360)
$url = $null
$listening = $false
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 900
    if (Test-Path -LiteralPath $BootLog) {
        $m = Select-String -LiteralPath $BootLog -Pattern 'dsh web:\s+(http://\S+)' -ErrorAction SilentlyContinue
        if ($m) { $url = $m.Matches[0].Groups[1].Value }
    }
    if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { $listening = $true; break }
    if ($proc.HasExited) { break }
}
if (-not $listening) {
    Get-Content -LiteralPath $BootLog -Tail 30 -ErrorAction SilentlyContinue | ForEach-Object { Info $_ }
    Get-Content -LiteralPath "$BootLog.err" -Tail 20 -ErrorAction SilentlyContinue | ForEach-Object { Info $_ }
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    Die 'the mirror server never listened'
}
Ok "listening on port $Port"
if ($url) { Ok "launch URL: $url" } else { Info 'launch URL not in the log yet (stdout buffering); poll the port' }
Ok "boot log: $BootLog"

# The plugin route must exist: GET /btw/ask is a 405 (not a 404).
$routeDeadline = (Get-Date).AddSeconds(180)
$routeCode = 0
while ((Get-Date) -lt $routeDeadline) {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/btw/ask" -UseBasicParsing -TimeoutSec 10
        $routeCode = [int]$r.StatusCode
    } catch {
        $resp = $_.Exception.Response
        if ($resp) { $routeCode = [int]$resp.StatusCode }
    }
    if ($routeCode -eq 405) { break }
    Start-Sleep -Seconds 2
}
if ($routeCode -ne 405) { Die "GET /btw/ask -> HTTP $routeCode (expected 405: route exists, method refused)" }
Ok 'GET /btw/ask -> 405 (host route registered)'
try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 20
    Ok "GET / -> HTTP $([int]$r.StatusCode)"
} catch {
    $resp = $_.Exception.Response
    if ($resp) { Ok "GET / -> HTTP $([int]$resp.StatusCode)" } else { Info "GET / failed: $($_.Exception.Message)" }
}

$runtime = [ordered]@{
    pid = $proc.Id; port = $Port; url = $url; bootLog = $BootLog
    errLog = "$BootLog.err"; mirrorHome = $MirrorHome; startedAt = (Get-Date).ToString('o')
}
$runtime | ConvertTo-Json | Set-Content -LiteralPath $RuntimeFile -Encoding UTF8
Ok "runtime: $RuntimeFile"

if ($KeepRunning) {
    Write-Host ''
    Write-Host "    mirror server left running: PID $($proc.Id)  port $Port" -ForegroundColor Yellow
    if ($url) { Write-Host "    URL: $url" -ForegroundColor Yellow }
} else {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Ok 'mirror server stopped'
}
