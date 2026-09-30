param(
    [string]$UnityEditor
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

$editorPresent = [bool]($UnityEditor -and (Test-Path -LiteralPath $UnityEditor -PathType Leaf))
$webSupport = $false
if ($editorPresent) {
    $webSupport = Test-Path -LiteralPath (Join-Path (Split-Path $UnityEditor) 'Data\PlaybackEngines\WebGLSupport')
}

[pscustomobject]@{
    OSArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    UnityEditor = $UnityEditor
    EditorPresent = $editorPresent
    WebBuildModulePresent = $webSupport
    LicenseActivation = 'Not checked; activate through Unity Hub before building.'
    BrowserBuild = 'Not tested.'
} | Format-List

if (-not $editorPresent) {
    Write-Warning 'Unity Editor is missing. Install Unity 6000.6.3f1 for Windows ARM64 and matching Web Build Support. Set UNITY_EDITOR for a custom installation.'
    exit 1
}

if (-not $webSupport) {
    Write-Warning 'Web Build Support is missing. Add the matching module in Unity Hub.'
    exit 1
}