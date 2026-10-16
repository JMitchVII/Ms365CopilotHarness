BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..\..\agent\W365Install.psm1') -Force
    $script:extId = 'abcdefghijklmnopabcdefghijklmnop'
}

Describe 'New-W365HostManifest' {
    It 'IN-01 has name, absolute bat path, stdio type and the extension origin' {
        $bat = Join-Path $TestDrive 'agent\host.bat'
        $m = New-W365HostManifest -ExtensionId $extId -HostPath $bat

        $m.name | Should -Be 'com.w365.harness'
        $m.path | Should -Be ([System.IO.Path]::GetFullPath($bat))
        [System.IO.Path]::IsPathRooted($m.path) | Should -BeTrue
        $m.type | Should -Be 'stdio'
        $m.allowed_origins | Should -Be @("chrome-extension://$extId/")
        $m.description | Should -Not -BeNullOrEmpty
    }
}

Describe 'Install-W365Host / Uninstall-W365Host' {
    BeforeEach {
        $script:agentDir = Join-Path $TestDrive 'agent'
        New-Item -ItemType Directory -Path $agentDir -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $agentDir 'host.bat') -Value '@echo off'
        $script:workspace = Join-Path $TestDrive 'workspace'
        # A throwaway key instead of the real Chrome one.
        $script:regPath = "HKCU:\Software\W365HarnessTest\$([guid]::NewGuid())"
    }
    AfterEach {
        Remove-Item -Path $regPath -Recurse -Force -ErrorAction SilentlyContinue
    }
    AfterAll {
        Remove-Item -Path 'HKCU:\Software\W365HarnessTest' -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'IN-02 writes the manifest and config files and points the registry key at the manifest' {
        Install-W365Host -ExtensionId $extId -AgentDir $agentDir -WorkspaceRoot $workspace -RegistryPath $regPath

        $manifestPath = Join-Path $agentDir 'com.w365.harness.json'
        $manifest = Get-Content -Raw $manifestPath | ConvertFrom-Json
        $manifest.path | Should -Be (Join-Path $agentDir 'host.bat')
        $manifest.allowed_origins | Should -Be @("chrome-extension://$extId/")

        (Get-ItemProperty -Path $regPath).'(default)' | Should -Be $manifestPath

        (Get-Content -Raw (Join-Path $agentDir 'config.json') | ConvertFrom-Json).workspaceRoot |
            Should -Be ([System.IO.Path]::GetFullPath($workspace))
        Test-Path $workspace | Should -BeTrue -Because 'the workspace folder is created if missing'
    }
}
