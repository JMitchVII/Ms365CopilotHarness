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

    It 'PG-02 resolves a nested relative path' {
        Resolve-WorkspacePath -Root $root -Path 'src\lib\b.ps1' | Should -Be (Join-Path $root 'src\lib\b.ps1')
    }

    It 'PG-03 rejects ..\ escapes with E_PATH_ESCAPE' {
        { Resolve-WorkspacePath -Root $root -Path '..\outside.txt' } | Should -Throw '*E_PATH_ESCAPE*'
        { Resolve-WorkspacePath -Root $root -Path 'src\..\..\outside.txt' } | Should -Throw '*E_PATH_ESCAPE*'
    }

    It 'PG-04 rejects an absolute path outside the root' {
        { Resolve-WorkspacePath -Root $root -Path 'C:\Windows\win.ini' } | Should -Throw '*E_PATH_ESCAPE*'
        { Resolve-WorkspacePath -Root $root -Path '\\server\share\x.txt' } | Should -Throw '*E_PATH_ESCAPE*'
    }

    It 'PG-05 allows an absolute path inside the root' {
        $inside = Join-Path $root 'docs\c.md'
        Resolve-WorkspacePath -Root $root -Path $inside | Should -Be $inside
    }

    It 'PG-06 rejects a sibling folder that shares the root as a prefix' {
        $evil = "$root-evil\x.txt"
        { Resolve-WorkspacePath -Root $root -Path $evil } | Should -Throw '*E_PATH_ESCAPE*'
        { Resolve-WorkspacePath -Root $root -Path '..\ws-evil\x.txt' } | Should -Throw '*E_PATH_ESCAPE*'
    }

    It 'PG-08 accepts forward slashes and normalises them' {
        Resolve-WorkspacePath -Root $root -Path 'src/lib/b.ps1' | Should -Be (Join-Path $root 'src\lib\b.ps1')
    }
}
