# Auto-restart wrapper для bulk HWK enricher.
# Решает chronic Windows-bash exit 127 / silent SIGPIPE / etc для долгих
# ts-node прогонов. Скрипт идемпотентен (atomic claim pattern), повторный
# запуск продолжает с того же места.

param(
  [int]$Concurrency = 24,
  [int]$MaxRestarts = 200,
  [int]$RestartDelaySec = 5,
  [switch]$NoProxy
)

$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDir = Split-Path -Parent $here
Set-Location $serverDir

$attempt = 0
$fastFails = 0

while ($attempt -lt $MaxRestarts) {
  $attempt = $attempt + 1
  Write-Host ""
  Write-Host "=== HWK bulk attempt $attempt / $MaxRestarts ===" -ForegroundColor Cyan
  Write-Host "    started at $(Get-Date -Format 'HH:mm:ss')"

  $cliArgs = @("tsx", "src/seo-pipeline/hwkBulkEnricher.ts", "--concurrency", "$Concurrency")
  if ($NoProxy) { $cliArgs = $cliArgs + "--no-proxy" }

  $startTs = Get-Date
  & npx @cliArgs
  $exit = $LASTEXITCODE
  $elapsedSec = ((Get-Date) - $startTs).TotalSeconds

  Write-Host ("    exited code=$exit after {0:N0}s" -f $elapsedSec) -ForegroundColor Yellow

  if ($elapsedSec -lt 30) {
    $fastFails = $fastFails + 1
    if ($fastFails -gt 5) {
      Write-Host "    too many fast failures — bailing out" -ForegroundColor Red
      break
    }
  } else {
    $fastFails = 0
  }

  Write-Host "    sleeping $RestartDelaySec s before restart..."
  Start-Sleep -Seconds $RestartDelaySec
}

Write-Host ""
Write-Host "=== Loop finished after $attempt attempts ===" -ForegroundColor Green
