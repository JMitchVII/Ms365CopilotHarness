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

        It 'AT-04 offset (1-based) and limit return that slice plus totalLines' {
            [System.IO.File]::WriteAllText((Join-Path $root 'n.txt'), ((1..10 | ForEach-Object { "L$_" }) -join "`n"))
            $data = Invoke-W365ReadFile -Root $root -CallArgs @{ path = 'n.txt'; offset = 4; limit = 3 }
            $data.content | Should -Be "4`tL4`n5`tL5`n6`tL6"
            $data.startLine | Should -Be 4
            $data.endLine | Should -Be 6
            $data.totalLines | Should -Be 10

            $tail = Invoke-W365ReadFile -Root $root -CallArgs @{ path = 'n.txt'; offset = 9; limit = 50 }
            $tail.content | Should -Be "9`tL9`n10`tL10"
            $tail.endLine | Should -Be 10
        }

        It 'AT-05 throws E_NOT_FOUND for a missing file (or a directory)' {
            { Invoke-W365ReadFile -Root $root -CallArgs @{ path = 'missing.txt' } } | Should -Throw 'E_NOT_FOUND*'
            New-Item -ItemType Directory -Path (Join-Path $root 'd') | Out-Null
            { Invoke-W365ReadFile -Root $root -CallArgs @{ path = 'd' } } | Should -Throw 'E_NOT_FOUND*'
        }

        It 'AT-06 preserves UTF-8 (with or without BOM) and drops the BOM' {
            # Non-ASCII built from char codes: PS 5.1 reads BOM-less .ps1 files as ANSI.
            $text = "caf$([char]0xE9) $([char]0x2713) $([char]0x65E5)$([char]0x672C)"
            [System.IO.File]::WriteAllText((Join-Path $root 'u.txt'), $text, [System.Text.UTF8Encoding]::new($false))
            [System.IO.File]::WriteAllText((Join-Path $root 'b.txt'), $text, [System.Text.UTF8Encoding]::new($true))
            (Invoke-W365ReadFile -Root $root -CallArgs @{ path = 'u.txt' }).content | Should -BeExactly "1`t$text"
            (Invoke-W365ReadFile -Root $root -CallArgs @{ path = 'b.txt' }).content | Should -BeExactly "1`t$text"
        }
    }
}
