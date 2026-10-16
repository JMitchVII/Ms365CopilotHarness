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

Export-ModuleMember -Function New-W365HostManifest
