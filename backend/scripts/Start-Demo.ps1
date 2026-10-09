param(
    [string]$DotnetExecutable = 'dotnet',
    [string]$FrontendPath = (Join-Path $PSScriptRoot '../../frontend/dist')
)
$ErrorActionPreference = 'Stop'
$apiRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$frontendDist = [IO.Path]::GetFullPath($FrontendPath)
if (-not (Test-Path -LiteralPath (Join-Path $frontendDist 'index.html'))) {
    throw 'Build the sibling frontend first: npm ci followed by npm run build.'
}
$dotnetCommand = (Get-Command $DotnetExecutable -ErrorAction Stop).Source
$runtimeDir = Join-Path $apiRoot '.runtime'
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$origin = 'http://127.0.0.1:4191'
try { $existing = Invoke-RestMethod "$origin/api/health" -TimeoutSec 2 } catch { $existing = $null }
if ($existing.service -eq 'Handshake Career Lab') {
    Write-Output "Handshake is already running at $origin"
    return
}
if (Get-NetTCPConnection -LocalPort 4191 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Port 4191 belongs to another process. Stop it explicitly before starting this demo.'
}
$previousRoot = $env:DOTNET_ROOT
$previousEnvironment = $env:ASPNETCORE_ENVIRONMENT
Push-Location $apiRoot
try {
    $env:DOTNET_ROOT = Split-Path $dotnetCommand
    $env:ASPNETCORE_ENVIRONMENT = 'Development'
    & $dotnetCommand build --configuration Release --nologo
    if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' }
    $apiDll = Join-Path $apiRoot 'bin/Release/net10.0/Handshake.Api.dll'
    $arguments = @(('"' + $apiDll + '"'), '--urls', $origin, '--Demo:Enabled', 'true', '--Frontend:Path', ('"' + $frontendDist + '"'))
    $process = Start-Process -FilePath $dotnetCommand -ArgumentList $arguments -WorkingDirectory $apiRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir 'demo.stdout.log') -RedirectStandardError (Join-Path $runtimeDir 'demo.stderr.log')
    @{ pid = $process.Id; startedAt = $process.StartTime.ToUniversalTime().ToString('o'); executable = $dotnetCommand; origin = $origin } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeDir 'demo-process.json')
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if ($process.HasExited) { throw "API exited. Inspect .runtime/demo.stderr.log and .runtime/demo.stdout.log." }
        try {
            $health = Invoke-RestMethod "$origin/api/health" -TimeoutSec 1
            if ($health.ok -eq $true) { Write-Output "Open $origin — synthetic local demo is ready."; return }
        } catch { }
        Start-Sleep -Milliseconds 500
        $process.Refresh()
    }
    throw 'API startup timed out. Inspect the local runtime logs.'
} finally {
    Pop-Location
    $env:DOTNET_ROOT = $previousRoot
    $env:ASPNETCORE_ENVIRONMENT = $previousEnvironment
}
