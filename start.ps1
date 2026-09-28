param([int]$Port = 4173, [switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
    throw 'Run: python -m venv .venv; .\.venv\Scripts\python.exe -m pip install -r requirements.txt'
}
$serverArgs = @((Join-Path $PSScriptRoot 'server.py'), '--port', $Port)
if ($NoBrowser) { $serverArgs += '--no-browser' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'Install Node.js 22.12 or newer, then run npm ci.'
}
Push-Location $PSScriptRoot
try {
    if (-not (Test-Path 'node_modules')) { throw 'Run npm ci before starting the studio.' }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    & $python @serverArgs
} finally {
    Pop-Location
}