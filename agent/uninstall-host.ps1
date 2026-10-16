# Removes the native messaging host registration (the workspace is left alone).
Import-Module (Join-Path $PSScriptRoot 'W365Install.psm1') -Force
Uninstall-W365Host -AgentDir $PSScriptRoot
Write-Host 'Uninstalled com.w365.harness'
