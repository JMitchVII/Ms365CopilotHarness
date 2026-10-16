# File transport agent: serves calls dropped into <SharedDir>\inbox until a <SharedDir>\stop file appears.
# Usage: powershell -NoProfile -File agent\file-loop.ps1 -SharedDir <folder> [-Root <workspace>]
# Root defaults to $env:W365_ROOT, then "workspaceRoot" in agent\config.json (written by install-host.ps1).
param(
    [Parameter(Mandatory)][string]$SharedDir,
    [string]$Root
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'W365Agent.psm1') -Force
if (-not $Root) { $Root = $env:W365_ROOT }
if (-not $Root) {
    $configPath = Join-Path $PSScriptRoot 'config.json'
    if (Test-Path -LiteralPath $configPath) { $Root = (Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json).workspaceRoot }
}
if (-not $Root) { throw 'No workspace root: pass -Root, set W365_ROOT, or run install-host.ps1' }
Write-Host "W365 file agent: workspace $Root, shared folder $SharedDir. Create '$SharedDir\stop' to quit."
Start-W365FileLoop -Root $Root -SharedDir $SharedDir -LogPath (Join-Path $PSScriptRoot 'logs\file-loop.log')
