param([int]$Port = 4173, [switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
    throw 'Run: python -m venv .venv; .\.venv\Scripts\python.exe -m pip install -r requirements.txt'
}
$serverArgs = @((Join-Path $PSScriptRoot 'server.py'), '--port', $Port)
if ($NoBrowser) { $serverArgs += '--no-browser' }
& $python @serverArgs