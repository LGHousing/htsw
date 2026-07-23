# Installs the htsw CLI. Usage:
#   irm https://legendarygames.dev/htsw/cli/install.ps1 | iex
#
# Environment overrides:
#   HTSW_BASE_URL   artifact root (default https://legendarygames.dev/htsw)
#   HTSW_BIN_DIR    install directory (default $HOME\.local\bin)
& {
$ErrorActionPreference = "Stop"

function Write-InstallMessage {
    param([string]$Message)
    Write-Host "[htsw-install] $Message"
}

function Test-PathEntry {
    param(
        [string]$PathValue,
        [string]$Entry
    )

    $normalizedEntry = [IO.Path]::GetFullPath($Entry).TrimEnd("\")
    foreach ($candidate in ($PathValue -split ";")) {
        if (-not [string]::IsNullOrWhiteSpace($candidate)) {
            $normalizedCandidate = [IO.Path]::GetFullPath($candidate).TrimEnd("\")
            if ($normalizedCandidate -eq $normalizedEntry) {
                return $true
            }
        }
    }
    return $false
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    throw "[htsw-install] Node.js 20+ is required but 'node' is not on PATH."
}

$nodeMajor = & node -p "process.versions.node.split('.')[0]"
if ([int]$nodeMajor -lt 20) {
    throw "[htsw-install] Node.js 20+ is required (found $(& node -v))."
}

$artifactRoot = if ($env:HTSW_BASE_URL) {
    $env:HTSW_BASE_URL.TrimEnd("/")
} else {
    "https://legendarygames.dev/htsw"
}
$baseUrl = "$artifactRoot/cli"
$usesDefaultBinDir = [string]::IsNullOrWhiteSpace($env:HTSW_BIN_DIR)
$binDir = if (-not $usesDefaultBinDir) {
    [IO.Path]::GetFullPath($env:HTSW_BIN_DIR)
} else {
    Join-Path $HOME ".local\bin"
}
$bundle = Join-Path $binDir "htsw.mjs"
$launcher = Join-Path $binDir "htsw.cmd"
$tempBundle = Join-Path $binDir ".htsw-download-$PID"

Write-InstallMessage "Reading $baseUrl/latest.json"
$manifest = Invoke-RestMethod -UseBasicParsing -Uri "$baseUrl/latest.json"
$file = [string]$manifest.cli
if ([string]::IsNullOrWhiteSpace($file)) {
    throw "[htsw-install] manifest missing 'cli' filename"
}

New-Item -ItemType Directory -Force -Path $binDir | Out-Null
try {
    Write-InstallMessage "Downloading htsw $($manifest.version)"
    Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/$file" -OutFile $tempBundle

    $expectedHash = [string]$manifest.sha256
    if (-not [string]::IsNullOrWhiteSpace($expectedHash)) {
        $actualHash = (Get-FileHash -Algorithm SHA256 -Path $tempBundle).Hash
        if ($actualHash -ne $expectedHash) {
            throw "[htsw-install] sha256 mismatch (expected $expectedHash, got $actualHash)"
        }
    }

    Move-Item -Force -Path $tempBundle -Destination $bundle
    @'
@echo off
node "%~dp0htsw.mjs" %*
'@ | Set-Content -Encoding Ascii -Path $launcher
} finally {
    Remove-Item -Force -ErrorAction SilentlyContinue -Path $tempBundle
}

if ($usesDefaultBinDir) {
    if (-not (Test-PathEntry -PathValue $env:Path -Entry $binDir)) {
        $env:Path = "$binDir;$env:Path"
    }

    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not (Test-PathEntry -PathValue $userPath -Entry $binDir)) {
        $newUserPath = if ([string]::IsNullOrWhiteSpace($userPath)) {
            $binDir
        } else {
            "$binDir;$userPath"
        }
        [Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
        Write-InstallMessage "Added $binDir to your user PATH."
    }
} elseif (-not (Test-PathEntry -PathValue $env:Path -Entry $binDir)) {
    Write-InstallMessage "$binDir is not on PATH. Add it to run 'htsw' directly."
}

Write-InstallMessage "Installed htsw $($manifest.version) to $binDir"
Write-InstallMessage "Update in place later with 'htsw upgrade'."
}
