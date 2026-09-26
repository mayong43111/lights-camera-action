param([int]$Port = 4173, [switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath($PSScriptRoot)
$listener = $null
for ($candidate = $Port; $candidate -lt $Port + 20; $candidate++) {
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $candidate)
        $listener.Start()
        $Port = $candidate
        break
    } catch {
        $listener = $null
    }
}
if (-not $listener) { throw 'No available local port.' }
$url = "http://127.0.0.1:$Port/"
Write-Host "Studio running at $url"
Write-Host 'Press Ctrl+C to stop.'
if (-not $NoBrowser) { Start-Process $url }
$types = @{ '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.vrm' = 'application/octet-stream'; '.glb' = 'model/gltf-binary'; '.svg' = 'image/svg+xml' }
try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $stream.ReadTimeout = 3000
            $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
            $request = $reader.ReadLine()
            if (-not $request) { continue }
            $parts = $request.Split(' ')
            $headerCount = 0
            do {
                $header = $reader.ReadLine()
                $headerCount++
                if ($headerCount -gt 100) { throw 'Too many headers.' }
            } while ($header)
            $relative = [System.Uri]::UnescapeDataString(($parts[1] -split '\?')[0]).TrimStart('/')
            if (-not $relative) { $relative = 'index.html' }
            $path = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($root, $relative))
            $status = '200 OK'
            $type = $types[[System.IO.Path]::GetExtension($path).ToLowerInvariant()]
            if ($parts[0] -notin @('GET', 'HEAD')) {
                $status = '405 Method Not Allowed'
            } elseif (-not $path.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
                $status = '403 Forbidden'
            } elseif (-not [System.IO.File]::Exists($path) -or -not $type) {
                $status = '404 Not Found'
            }
            if ($status -eq '200 OK') {
                $body = [System.IO.File]::ReadAllBytes($path)
            } else {
                $body = [System.Text.Encoding]::UTF8.GetBytes($status)
                $type = 'text/plain; charset=utf-8'
            }
            $response = "HTTP/1.1 $status`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`nConnection: close`r`n`r`n"
            $bytes = [System.Text.Encoding]::ASCII.GetBytes($response)
            $stream.Write($bytes, 0, $bytes.Length)
            if ($parts[0] -ne 'HEAD') { $stream.Write($body, 0, $body.Length) }
            $stream.Flush()
        } catch {
            Write-Warning $_.Exception.Message
        } finally {
            $client.Dispose()
        }
    }
} finally {
    $listener.Stop()
}