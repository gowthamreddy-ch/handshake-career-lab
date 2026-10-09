$ErrorActionPreference = 'Stop'
$stateFile = Join-Path $PSScriptRoot '../.runtime/demo-process.json'
if (-not (Test-Path -LiteralPath $stateFile)) { Write-Output 'No launcher-owned demo process recorded.'; return }
$state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
$process = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
if (-not $process) { Write-Output 'The recorded demo process has already stopped.'; return }
$recordedStart = ([DateTime]$state.startedAt).ToUniversalTime()
if ($process.Path -ne $state.executable -or $process.StartTime.ToUniversalTime().Ticks -ne $recordedStart.Ticks) {
    throw 'The process identity has changed. Refusing to stop another process.'
}
Stop-Process -Id $process.Id
Write-Output 'Handshake demo stopped. Its local data is preserved.'
