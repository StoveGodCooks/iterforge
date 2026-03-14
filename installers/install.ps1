# IterForge CLI Installer (Windows PowerShell)
# Usage: powershell -ExecutionPolicy Bypass -File install.ps1

param(
    [switch]$Silent = $false
)

$ErrorActionPreference = "Stop"

function Write-Status($msg) {
    if (-not $Silent) { Write-Host $msg -ForegroundColor Cyan }
}

function Write-Failure($msg) {
    Write-Host "ERROR: $msg" -ForegroundColor Red
    exit 1
}

try {
    Write-Status "IterForge Installer"
    Write-Status "==================`n"

    # Check Node.js 18+
    Write-Status "Checking Node.js..."
    try {
        $nodeVersion = node --version
    } catch {
        Write-Failure "Node.js 18+ not found. Install from https://nodejs.org"
    }
    $nodeMajor = [int]($nodeVersion -replace 'v(\d+)\..*','$1')
    if ($nodeMajor -lt 18) {
        Write-Failure "Node.js $nodeVersion is below minimum required v18. Install from https://nodejs.org"
    }
    Write-Status "  OK  Node.js $nodeVersion`n"

    # Install npm package globally from local repo
    Write-Status "Installing IterForge CLI..."
    $repoRoot = Split-Path -Parent $PSScriptRoot
    npm install -g $repoRoot 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Failure "npm install failed. Check npm permissions."
    }
    Write-Status "  OK  IterForge CLI installed`n"

    # Verify PATH resolution
    Write-Status "Verifying installation..."
    try {
        $ver = iterforge --version
    } catch {
        Write-Failure "iterforge command not found after install. Open a new terminal and retry, or run: npm bin -g to check PATH."
    }
    Write-Status "  OK  $ver`n"

    # Run doctor
    Write-Status "Running health check..."
    iterforge doctor
    Write-Status ""

    Write-Status "Installation complete! Next steps:"
    Write-Status "  1. cd your-godot-project"
    Write-Status "  2. iterforge init"
    Write-Status "  3. iterforge install  (downloads Python + ComfyUI)"
    Write-Status "  4. iterforge start comfyui"
    Write-Status "  5. iterforge generate arena"
}
catch {
    Write-Failure $_
}
