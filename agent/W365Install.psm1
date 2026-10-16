# Registers the agent as a Chrome native messaging host for the current user (HKCU, no admin needed).
Set-StrictMode -Version Latest

$script:HostName = 'com.w365.harness'

function New-W365HostManifest {
    param([Parameter(Mandatory)][string]$ExtensionId, [Parameter(Mandatory)][string]$HostPath)
    [ordered]@{
        name            = $script:HostName
        description     = 'W365 Copilot harness agent'
        path            = [System.IO.Path]::GetFullPath($HostPath)
        type            = 'stdio'
        allowed_origins = @("chrome-extension://$ExtensionId/")
    }
}

$script:ChromeHostKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$script:HostName"
$script:Utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Write-JsonFile {
    param([string]$Path, $Object)
    [System.IO.File]::WriteAllText($Path, (ConvertTo-Json -InputObject $Object -Depth 5), $script:Utf8NoBom)
}

function Install-W365Host {
    param(
        [Parameter(Mandatory)][string]$ExtensionId,
        [Parameter(Mandatory)][string]$WorkspaceRoot,
        [string]$AgentDir = $PSScriptRoot,
        [string]$RegistryPath = $script:ChromeHostKey
    )
    $agentFull = [System.IO.Path]::GetFullPath($AgentDir)
    $rootFull = [System.IO.Path]::GetFullPath($WorkspaceRoot)
    if (-not (Test-Path -LiteralPath $rootFull)) { New-Item -ItemType Directory -Path $rootFull -Force | Out-Null }

    $manifestPath = Join-Path $agentFull "$script:HostName.json"
    Write-JsonFile $manifestPath (New-W365HostManifest -ExtensionId $ExtensionId -HostPath (Join-Path $agentFull 'host.bat'))
    Write-JsonFile (Join-Path $agentFull 'config.json') ([ordered]@{ workspaceRoot = $rootFull })

    if (-not (Test-Path -Path $RegistryPath)) { New-Item -Path $RegistryPath -Force | Out-Null }
    Set-Item -Path $RegistryPath -Value $manifestPath
}

Export-ModuleMember -Function New-W365HostManifest, Install-W365Host
