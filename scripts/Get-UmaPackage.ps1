$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$directory = Join-Path $root 'Downloads'
$destination = Join-Path $directory 'UMA31_f1.unitypackage'
$expectedHash = '701a87dfd7e8a00a65f5a8066e23e8a3d62327214269992776db2cc7efe48866'
$url = 'https://github.com/umasteeringgroup/UMA/releases/download/V3.1f1/UMA31_f1.unitypackage'

if (Test-Path -LiteralPath $destination) {
    if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -eq $expectedHash) {
        Write-Output $destination
        exit 0
    }
    throw "Existing package checksum does not match the pinned release: $destination"
}

New-Item -ItemType Directory -Path $directory -Force | Out-Null
$temporary = "$destination.partial"
Invoke-WebRequest -Uri $url -OutFile $temporary
if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash -ne $expectedHash) {
    throw "Downloaded package checksum does not match. Do not import: $temporary"
}
Move-Item -LiteralPath $temporary -Destination $destination
Get-Item -LiteralPath $destination | Select-Object FullName, Length