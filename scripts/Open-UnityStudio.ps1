param(
    [string]$UnityEditor,
    [switch]$ImportUMA,
    [switch]$Interactive,
    [string]$ExecuteMethod,
    [string]$BuildTarget,
    [string]$LogPath
)

$ErrorActionPreference = 'Stop'
if (-not $UnityEditor) {
    $UnityEditor = $env:UNITY_EDITOR
}
if (-not $UnityEditor) {
    $UnityEditor = Join-Path $env:ProgramFiles 'Unity\Hub\Editor\6000.6.3f1\Editor\Unity.exe'
    if (-not (Test-Path -LiteralPath $UnityEditor -PathType Leaf)) {
        $UnityEditor = Join-Path $env:ProgramFiles 'Unity 6000.6.3f1\Editor\Unity.exe'
    }
}
if (-not (Test-Path -LiteralPath $UnityEditor -PathType Leaf)) {
    throw 'Install Unity 6000.6.3f1 ARM64 with Web Build Support and activate a license in Hub. For a custom location, set UNITY_EDITOR to Editor\Unity.exe.'
}

$root = Split-Path $PSScriptRoot
$project = Join-Path $root 'UnityStudio'
$lockPath = Join-Path $project 'Temp\UnityLockfile'
if (Test-Path -LiteralPath $lockPath) {
    try {
        $lockProbe = [System.IO.File]::Open($lockPath, 'Open', 'ReadWrite', 'None')
        $lockProbe.Dispose()
    } catch [System.IO.IOException] {
        throw 'The project lock is in use. Close its Editor before launching this command.'
    }
}
$arguments = @('-projectPath', "`"$project`"", '-force-d3d11')
if (-not $Interactive) {
    $arguments += @('-batchmode', '-quit')
}
if (-not $LogPath) {
    $LogPath = Join-Path $root 'Logs\unity-batch.log'
}
$LogPath = [System.IO.Path]::GetFullPath($LogPath)
New-Item -ItemType Directory -Path (Split-Path $LogPath) -Force | Out-Null
$arguments += @('-logFile', "`"$LogPath`"")
if ($ExecuteMethod) {
    $arguments += @('-executeMethod', $ExecuteMethod)
}
if ($BuildTarget) {
    $arguments += @('-buildTarget', $BuildTarget)
}
if ($ImportUMA) {
    $package = Join-Path $root 'Downloads\UMA31_f1.unitypackage'
    if (-not (Test-Path -LiteralPath $package)) {
        throw 'Run scripts/Get-UmaPackage.ps1 before importing UMA.'
    }
    $expectedHash = '701a87dfd7e8a00a65f5a8066e23e8a3d62327214269992776db2cc7efe48866'
    if ((Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash -ne $expectedHash) {
        throw 'UMA package checksum mismatch. Import cancelled.'
    }
    $arguments += @('-importPackage', "`"$package`"")
}
if ($Interactive) {
    Start-Process -FilePath $UnityEditor -ArgumentList $arguments
    Write-Output "Interactive Editor launch requested. Log: $LogPath"
} else {
    Write-Output "Starting Unity batch process. Log: $LogPath"
    $process = Start-Process -FilePath $UnityEditor -ArgumentList $arguments -Wait -PassThru
    Write-Output "UnityExitCode=$($process.ExitCode)"
    if ($process.ExitCode -ne 0) {
        throw "Unity batch process failed. Inspect the log: $LogPath"
    }
    Write-Output 'Unity batch process completed. Character generation and Web output require their own validation.'
}