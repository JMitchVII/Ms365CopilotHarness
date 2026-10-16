BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..\..\agent\W365Agent.psm1') -Force
}

Describe 'Agent tools' {
    BeforeEach {
        $script:root = Join-Path $TestDrive 'ws'
        Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
        New-Item -ItemType Directory -Path $root -Force | Out-Null
    }

    Context 'list_dir' {
        It 'AT-01 returns name, type and size for each entry, sorted by name' {
            Set-Content -LiteralPath (Join-Path $root 'b.txt') -Value 'hello' -NoNewline
            New-Item -ItemType Directory -Path (Join-Path $root 'a-dir') | Out-Null
            Set-Content -LiteralPath (Join-Path $root 'C.md') -Value '' -NoNewline

            $data = Invoke-W365ListDir -Root $root -CallArgs @{}

            $data.entries.name | Should -Be @('a-dir', 'b.txt', 'C.md')
            $data.entries[0].type | Should -Be 'dir'
            $data.entries[1].type | Should -Be 'file'
            $data.entries[1].size | Should -Be 5
        }

        It 'AT-02 throws E_NOT_FOUND for a missing directory' {
            { Invoke-W365ListDir -Root $root -CallArgs @{ path = 'nope' } } | Should -Throw 'E_NOT_FOUND*'
        }
    }

    Context 'read_file' {
        It 'AT-03 returns the content with line numbers' {
            [System.IO.File]::WriteAllText((Join-Path $root 'a.txt'), "one`r`ntwo`nthree")
            $data = Invoke-W365ReadFile -Root $root -CallArgs @{ path = 'a.txt' }
            $data.content | Should -Be "1`tone`n2`ttwo`n3`tthree"
            $data.totalLines | Should -Be 3
        }
    }
}
