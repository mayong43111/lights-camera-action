param(
    [ValidateSet('Development', 'Production')]
    [string]$Mode = 'Development',
    [ValidateRange(1024, 65535)]
    [int]$Port = 4173,
    [ValidateRange(1024, 65535)]
    [int]$FrontendPort = 4178,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
    throw 'Run: python -m venv .venv; .\.venv\Scripts\python.exe -m pip install -r requirements.txt'
}
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $npm -or -not $node) {
    throw 'Install Node.js 22.12 or newer, then run npm ci.'
}

function Assert-PortAvailable([int]$ListenPort) {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $ListenPort)
    try {
        $listener.Server.ExclusiveAddressUse = $true
        $listener.Start()
    } catch {
        throw "Port $ListenPort is in use. Stop the existing service or choose another port."
    } finally {
        $listener.Stop()
    }
}

$backend = $null
$previousApiUrl = $env:STUDIO_API_URL
Push-Location $PSScriptRoot
try {
    if (-not (Test-Path 'node_modules/vite/bin/vite.js')) { throw 'Run npm ci before starting the studio.' }
    Assert-PortAvailable $Port
    $serverArgs = @('server.py', '--port', $Port, '--strict-port')
    if ($Mode -eq 'Production') {
        if ($NoBrowser) { $serverArgs += '--no-browser' }
        & $npm.Source run build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
        & $python @serverArgs
        if ($LASTEXITCODE -ne 0) { throw 'Studio server exited with an error.' }
    } else {
        if ($Port -eq $FrontendPort) { throw 'API and frontend ports must be different.' }
        Assert-PortAvailable $FrontendPort
        $env:STUDIO_API_URL = "http://127.0.0.1:$Port"
        $backend = Start-Process -FilePath $python -ArgumentList (@('-u') + $serverArgs + @('--no-browser', '--reload')) -WorkingDirectory $PSScriptRoot -NoNewWindow -PassThru
        Write-Host "Development studio: http://127.0.0.1:$FrontendPort/"
        Write-Host "API: $env:STUDIO_API_URL (reload enabled). Ctrl+C stops both services."
        $viteArgs = @('node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', $FrontendPort, '--strictPort')
        if (-not $NoBrowser) { $viteArgs += '--open' }
        & $node.Source @viteArgs
        if ($LASTEXITCODE -ne 0) { throw 'Vite exited with an error.' }
    }
} finally {
    if ($backend -and -not $backend.HasExited) {
        & taskkill.exe /PID $backend.Id /T /F 2>$null | Out-Null
    }
    $env:STUDIO_API_URL = $previousApiUrl
    Pop-Location
}