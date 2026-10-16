BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..\..\agent\W365Agent.psm1') -Force
}

Describe 'Resolve-WorkspacePath' {
    BeforeEach {
        $script:root = Join-Path $TestDrive 'ws'
        New-Item -ItemType Directory -Path $root -Force | Out-Null
    }

    It 'PG-01 resolves a relative file name to a full path under the root' {
        Resolve-WorkspacePath -Root $root -Path 'a.txt' | Should -Be (Join-Path $root 'a.txt')
    }
}
