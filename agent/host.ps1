# Native messaging host entry point. Chrome starts this via host.bat and talks over stdin/stdout.
# Chrome passes its own arguments (the caller origin, --parent-window=N); they're accepted and ignored.
#
# Workspace root, first match wins: $env:W365_ROOT, then "workspaceRoot" in config.json next to this script.
# Log file: $env:W365_LOG, else logs\host.log next to this script.
[CmdletBinding(PositionalBinding = $false)]
param([Parameter(ValueFromRemainingArguments)][string[]]$ChromeArgs)

# stdout is the message channel. Take the raw stream for frames, then silence everything else that could
# write to it: Console.Out, and (via *> $null below) every PowerShell output stream.
$frameOut = [Console]::OpenStandardOutput()
$frameIn = [Console]::OpenStandardInput()
[Console]::SetOut([System.IO.TextWriter]::Null)

$logPath = if ($env:W365_LOG) { $env:W365_LOG } else { Join-Path $PSScriptRoot 'logs\host.log' }

& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    try {
        Import-Module (Join-Path $PSScriptRoot 'W365Agent.psm1') -Force

        if ($env:W365_HOST_NOISE) {
            # Test hook (NH-03): none of this may reach stdout.
            Write-Host 'noise: host'; Write-Output 'noise: output'; Write-Warning 'noise: warning'
            Write-Verbose 'noise: verbose' -Verbose; Write-Information 'noise: info'; [Console]::WriteLine('noise: console')
        }

        $root = $env:W365_ROOT
        if (-not $root) {
            $configPath = Join-Path $PSScriptRoot 'config.json'
            if (Test-Path -LiteralPath $configPath) { $root = (Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json).workspaceRoot }
        }
        if (-not $root) { throw 'No workspace root: set W365_ROOT or workspaceRoot in agent\config.json' }

        Invoke-W365HostLoop -Root $root -InStream $frameIn -OutStream $frameOut -LogPath $logPath
    } catch {
        $dir = Split-Path -Parent $logPath
        if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) FATAL $($_.Exception.Message)"
        exit 1
    }
} *> $null
