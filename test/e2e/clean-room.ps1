<#
.SYNOPSIS
    Build a genuinely fresh DSH home, install ONLY this plugin into it, boot the
    Web GUI on a spare port, and print the launch URL.

.DESCRIPTION
    Unlike the mirror rehearsal (which copies the live company profile), this home
    starts from nothing: the profile is seeded with the two official bundles, and
    the only third-party entry is the package under test. That is the install a
    community user gets.

    Steps, in order:
      1. refuse to reuse an existing home (a stale home hides first-run gaps)
      2. seed profiles/web/package.json with the official bundles only
      3. copy the credential store (a real provider key is required for answers)
      4. install the package: a local directory is junction-linked; an npm spec
         goes through `dsh plugin --profile web add <spec>` (pnpm, the sanctioned
         route), then the package name is added to dsh.profile.bundles
      5. seed storages/workspace.json with one workspace, as the GUI's onboarding
         would after a person picks a folder
      6. compose and fail on any loader complaint
      7. boot `web --no-open` and wait for GET /btw/ask -> 405
      8. run first-run.mjs afterwards (headless Chrome required) to dismiss the
         preview notice before any E2E mode runs

.PARAMETER PackageSpec
    An absolute local package directory, or an npm spec such as
    @andrewhmir/dsh-btw@0.1.2.

.PARAMETER HomeDir
    The fresh DSH home to create. Must not already exist.

.PARAMETER CliPrefix
    The scratch install prefix holding node_modules/@deepseek-ai/dsh.

.PARAMETER Port
    Port for the Web GUI.

.PARAMETER KeepRunning
    Leave the server up and print its pid.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File clean-room.ps1 `
      -PackageSpec C:\Users\Andrew\Desktop\dsh_andrew\dsh-btw `
      -HomeDir C:\Users\Andrew\Desktop\dsh_andrew\.harness-check\home-clean-1 `
      -CliPrefix C:\Users\Andrew\Desktop\dsh_andrew\.harness-check\prefix-021 `
      -Port 3166 -KeepRunning
#>
param(
    [Parameter(Mandatory = $true)][string] $PackageSpec,
    [Parameter(Mandatory = $true)][string] $HomeDir,
    [Parameter(Mandatory = $true)][string] $CliPrefix,
    [int]    $Port = 3165,
    [switch] $KeepRunning,
    [string] $CredentialsFrom = "$env:USERPROFILE\.dsh-company\.credentials.yaml"
)

# Windows PowerShell 5.1 turns native stderr into a terminating error under
# 'Stop'. Every native call goes through cmd /c and is judged by $LASTEXITCODE.
$ErrorActionPreference = 'Stop'

$Cli         = Join-Path $CliPrefix 'node_modules\@deepseek-ai\dsh\lib\bin.js'
$Here        = Split-Path -Parent $MyInvocation.MyCommand.Path
$PatchHelper = Join-Path $Here 'patch-clean-room-profile.mjs'
$ProfileDir  = Join-Path $HomeDir 'profiles\web'
$NodeModules = Join-Path $ProfileDir 'node_modules'
$WorkspaceDir = Join-Path $HomeDir 'workspace'
$StoragesDir = Join-Path $HomeDir 'storages'
$LogDir      = Join-Path $HomeDir 'logs'
$Stamp       = Get-Date -Format 'yyyyMMdd-HHmmss'
$DumpLog     = Join-Path $LogDir "dump-$Stamp.txt"
$DumpErr     = Join-Path $LogDir "dump-$Stamp.err.txt"
$BootLog     = Join-Path $LogDir "boot-$Stamp.log"
$InstallLog  = Join-Path $LogDir "install-$Stamp.log"

function Die($message) { Write-Host "    FAIL  $message" -ForegroundColor Red; exit 1 }
function Ok($message) { Write-Host "    OK    $message" -ForegroundColor Green }
function Info($message) { Write-Host "    ..    $message" -ForegroundColor Gray }

$proc = $null

Write-Host ''
Write-Host "clean room: $HomeDir  (package: $PackageSpec)"

# --- 0. preconditions -------------------------------------------------------
if (-not (Test-Path -LiteralPath $Cli)) { Die "scratch CLI not found: $Cli" }
if (Test-Path -LiteralPath $HomeDir) { Die "HomeDir already exists: $HomeDir (a reused home does not test first run)" }
if (-not (Test-Path -LiteralPath $PatchHelper)) { Die "missing helper: $PatchHelper" }
Info "CLI: node $Cli"

# --- 1. fresh profile skeleton ---------------------------------------------
$null = New-Item -ItemType Directory -Force -Path $NodeModules
$null = New-Item -ItemType Directory -Force -Path $WorkspaceDir
$null = New-Item -ItemType Directory -Force -Path $StoragesDir
$null = New-Item -ItemType Directory -Force -Path $LogDir

$manifest = Join-Path $ProfileDir 'package.json'
$seed = '{"name":"dsh-profile-web","private":true,"dependencies":{},"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]}}}'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($manifest, $seed, $utf8NoBom)
Ok 'seeded a profile with only the official bundles'

if (Test-Path -LiteralPath $CredentialsFrom) {
    Copy-Item -LiteralPath $CredentialsFrom -Destination (Join-Path $HomeDir '.credentials.yaml') -Force
    Ok "provider credentials copied from $CredentialsFrom"
} else {
    Info "no credential store at $CredentialsFrom - only error-overlay paths will work"
}

# --- 2. one workspace, as the GUI's onboarding would create -----------------
$workspaceId = '11111111-1111-4111-8111-111111111111'
$now = (Get-Date).ToUniversalTime().ToString('o')
$state = [ordered]@{
    unit    = [ordered]@{ name = 'workspace'; version = 2 }
    global  = [ordered]@{
        initialized        = $true
        workspaceIds       = @($workspaceId)
        archivedSessionIds = @()
        pinnedSessionIds   = @()
        defaultWorkspaceId = $workspaceId
    }
    tables  = [ordered]@{ workspaces = [ordered]@{} }
}
$state.tables.workspaces[$workspaceId] = [ordered]@{
    path      = $WorkspaceDir
    title     = 'clean-room'
    sessionIds = @()
    createdAt = $now
    updatedAt = $now
}
$workspaceJson = $state | ConvertTo-Json -Depth 8
$workspaceFile = Join-Path $StoragesDir 'workspace.json'
Set-Content -LiteralPath $workspaceFile -Value $workspaceJson -Encoding ASCII
Ok 'seeded one workspace (no "Choose workspace" onboarding)'

# --- 3. install the package under test -------------------------------------
$isLocalDir = Test-Path -LiteralPath $PackageSpec -PathType Container
if ($isLocalDir) {
    $localDir = (Resolve-Path -LiteralPath $PackageSpec).Path
    $pluginManifest = Join-Path $localDir 'package.json'
    if (-not (Test-Path -LiteralPath $pluginManifest)) { Die "no package.json in $localDir" }
    $packageName = (Get-Content -LiteralPath $pluginManifest -Raw | ConvertFrom-Json).name
    if ([string]::IsNullOrWhiteSpace($packageName)) { Die "no name in $pluginManifest" }

    $linkPath = Join-Path $NodeModules ($packageName -replace '/', '\')
    $linkParent = Split-Path -Parent $linkPath
    if (-not (Test-Path -LiteralPath $linkParent)) { $null = New-Item -ItemType Directory -Force -Path $linkParent }
    if (Test-Path -LiteralPath $linkPath) { cmd /c "rmdir `"$linkPath`"" | Out-Null }
    cmd /c "mklink /J `"$linkPath`" `"$localDir`" > `"$InstallLog`" 2>&1"
    if ($LASTEXITCODE -ne 0) { Get-Content -LiteralPath $InstallLog -Tail 5 | ForEach-Object { Info $_ }; Die 'junction creation failed' }
    Ok "linked $packageName -> $localDir"

    cmd /c "node `"$PatchHelper`" `"$ProfileDir`" `"$packageName`" `"$localDir`" > `"$InstallLog`" 2>&1"
    if ($LASTEXITCODE -ne 0) { Get-Content -LiteralPath $InstallLog -Tail 10 | ForEach-Object { Info $_ }; Die 'profile patch failed' }
} else {
    if ($PackageSpec -match '^(@[^/]+/[^@]+|[^@]+)') { $packageName = $Matches[1] } else { Die "cannot read a package name from spec '$PackageSpec'" }
    $env:DSH_HOME = $HomeDir
    cmd /c "node `"$Cli`" plugin --profile web add `"$PackageSpec`" > `"$InstallLog`" 2>&1"
    if ($LASTEXITCODE -ne 0) {
        Get-Content -LiteralPath $InstallLog -Tail 20 | ForEach-Object { Info $_ }
        Die "dsh plugin add failed (exit $LASTEXITCODE) - see $InstallLog"
    }
    Ok "installed from the registry spec: $PackageSpec"

    cmd /c "node `"$PatchHelper`" `"$ProfileDir`" `"$packageName`" > `"$InstallLog`" 2>&1"
    if ($LASTEXITCODE -ne 0) { Get-Content -LiteralPath $InstallLog -Tail 10 | ForEach-Object { Info $_ }; Die 'profile patch failed' }
}
Ok "bundle entry: $packageName"

# --- 4. compose -------------------------------------------------------------
$env:DSH_HOME = $HomeDir
cmd /c "node `"$Cli`" --profile web --dump-config > `"$DumpLog`" 2> `"$DumpErr`""
if ($LASTEXITCODE -ne 0) {
    Get-Content -LiteralPath $DumpErr -ErrorAction SilentlyContinue | Select-Object -First 25 | ForEach-Object { Info $_ }
    Die "composition failed (exit $LASTEXITCODE) - see $DumpErr"
}
$dump = Get-Content -LiteralPath $DumpLog
Ok "composition exit 0, $($dump.Count) lines -> $DumpLog"

if (($dump | Select-String -Pattern "^\s*-?\s*id:\s*'?btw'?\s*$").Count -lt 1) { Die 'the btw row is MISSING from the composed config' }
Ok 'entry present: btw'
$escapedName = [regex]::Escape($packageName)
if (($dump | Select-String -Pattern "name:\s*'?$escapedName'?\s*$").Count -lt 1) { Die "the btw row does not resolve to $packageName" }
Ok "entry resolves: $packageName"
$problems = @()
foreach ($pattern in 'not found', 'unknown key', 'cannot resolve', 'did not activate', 'is not a function', 'undefined is not') {
    foreach ($hit in ($dump | Select-String -Pattern $pattern -SimpleMatch)) { $problems += $hit.Line.Trim() }
}
if ($problems.Count -gt 0) { foreach ($problem in ($problems | Select-Object -Unique)) { Die "composed config complains: $problem" } }
Ok 'no loader complaint'

# --- 5. cold boot -----------------------------------------------------------
Info 'starting a cold boot (1-3 minutes is normal for a fresh home)'
$proc = Start-Process -FilePath 'node' -ArgumentList @("`"$Cli`"", 'web', '--port', "$Port", '--no-open') `
    -WindowStyle Hidden -PassThru -RedirectStandardOutput $BootLog -RedirectStandardError "$BootLog.err"

# Readiness is an HTTP probe, never Get-NetTCPConnection: under a sandbox the
# connection table cannot see listeners owned by another job.
$deadline = (Get-Date).AddSeconds(360)
$url = $null
$routeCode = 0
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 900
    if (Test-Path -LiteralPath $BootLog) {
        $match = Select-String -LiteralPath $BootLog -Pattern 'dsh web:\s+(http://\S+)' -ErrorAction SilentlyContinue
        if ($match) { $url = $match.Matches[0].Groups[1].Value }
    }
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/btw/ask" -UseBasicParsing -TimeoutSec 5
        $routeCode = [int]$response.StatusCode
    } catch {
        $webResponse = $_.Exception.Response
        if ($webResponse) { $routeCode = [int]$webResponse.StatusCode } else { $routeCode = 0 }
    }
    if ($routeCode -eq 405) { break }
    if ($proc.HasExited) { break }
}
if ($routeCode -ne 405) {
    if (Test-Path -LiteralPath $BootLog) { Get-Content -LiteralPath $BootLog -Tail 25 | ForEach-Object { Info $_ } }
    if (Test-Path -LiteralPath "$BootLog.err") { Get-Content -LiteralPath "$BootLog.err" -Tail 15 | ForEach-Object { Info $_ } }
    if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    Die "the clean-room server never answered GET /btw/ask (last code: $routeCode)"
}
Ok 'GET /btw/ask -> 405 (host route registered)'

# The launch URL is written when the boot completes and stdout is buffered, so
# it can land a moment after the route answers. Give it a bounded re-read.
if (-not $url) {
    $urlDeadline = (Get-Date).AddSeconds(45)
    while ((Get-Date) -lt $urlDeadline -and -not $url) {
        Start-Sleep -Milliseconds 800
        if (Test-Path -LiteralPath $BootLog) {
            $match = Select-String -LiteralPath $BootLog -Pattern 'dsh web:\s+(http://\S+)' -ErrorAction SilentlyContinue
            if ($match) { $url = $match.Matches[0].Groups[1].Value }
        }
    }
}
if ($url) { Ok "launch URL: $url" } else { Info 'launch URL not in the log yet; derive it from the boot log once it flushes' }

$runtime = [ordered]@{
    pid           = $proc.Id
    port          = $Port
    url           = $url
    home          = $HomeDir
    packageSpec   = $PackageSpec
    packageName   = $packageName
    bootLog       = $BootLog
    errLog        = "$BootLog.err"
    dumpLog       = $DumpLog
    startedAt     = (Get-Date).ToString('o')
}
$runtimeFile = Join-Path $LogDir 'clean-room-runtime.json'
Set-Content -LiteralPath $runtimeFile -Value ($runtime | ConvertTo-Json) -Encoding ASCII
Ok "runtime: $runtimeFile"

Write-Host ''
Write-Host "    HOME=$HomeDir"
Write-Host "    URL=$url"
Write-Host "    PID=$($proc.Id)"

if ($KeepRunning) {
    Write-Host ''
    Write-Host '    next: node dsh-btw/test/e2e/first-run.mjs --port 9222 --url "<URL>"' -ForegroundColor Yellow
    Write-Host '          (headless Chrome with --remote-debugging-port=9222 must already be running)' -ForegroundColor Yellow
} else {
    if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    Ok 'clean-room server stopped'
}
