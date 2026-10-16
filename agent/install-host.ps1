# Registers the agent as Chrome's native messaging host for the current user.
# Usage: powershell -NoProfile -File agent\install-host.ps1 -ExtensionId <id> -WorkspaceRoot <folder>
param(
    [Parameter(Mandatory)][string]$ExtensionId,
    [Parameter(Mandatory)][string]$WorkspaceRoot
)
Import-Module (Join-Path $PSScriptRoot 'W365Install.psm1') -Force
Install-W365Host -ExtensionId $ExtensionId -WorkspaceRoot $WorkspaceRoot -AgentDir $PSScriptRoot
Write-Host "Installed com.w365.harness for extension $ExtensionId; workspace $WorkspaceRoot"
