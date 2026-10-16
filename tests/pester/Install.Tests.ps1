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
