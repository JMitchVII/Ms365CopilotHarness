# Runs the Pester suites. Usage: powershell -NoProfile -File tests\run-pester.ps1 [-Path tests\pester\X.Tests.ps1]
param([string]$Path = (Join-Path $PSScriptRoot 'pester'))
Import-Module Pester -MinimumVersion 5.5 -ErrorAction Stop
$config = New-PesterConfiguration
$config.Run.Path = $Path
$config.Run.Exit = $true
$config.Output.Verbosity = 'Detailed'
Invoke-Pester -Configuration $config
