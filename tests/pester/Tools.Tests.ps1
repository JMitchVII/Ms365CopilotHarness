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

    Context 'write_file' {
        It 'AT-07 creates the file and any missing parent folders' {
            $data = Invoke-W365WriteFile -Root $root -CallArgs @{ path = 'new\deep\f.txt'; content = "hi`n" }
            [System.IO.File]::ReadAllText((Join-Path $root 'new\deep\f.txt')) | Should -BeExactly "hi`n"
            $data.path | Should -Be 'new\deep\f.txt'
            $data.bytes | Should -Be 3
        }

        It 'AT-08 overwrites as UTF-8 without BOM and keeps the supplied line endings' {
            $file = Join-Path $root 'f.txt'
            [System.IO.File]::WriteAllText($file, 'old content that is longer')
            $text = "a`r`nb`nc$([char]0xE9)"
            Invoke-W365WriteFile -Root $root -CallArgs @{ path = 'f.txt'; content = $text } | Out-Null
            $bytes = [System.IO.File]::ReadAllBytes($file)
            $bytes[0] | Should -Not -Be 0xEF
            [System.Text.Encoding]::UTF8.GetString($bytes) | Should -BeExactly $text
        }

        It 'AT-18 rejects content whose line count differs from expectLines, leaving the file alone' {
            $file = Join-Path $root 'g.txt'
            [System.IO.File]::WriteAllText($file, 'original')
            { Invoke-W365WriteFile -Root $root -CallArgs @{ path = 'g.txt'; content = "1`n2`n3"; expectLines = 4 } } |
                Should -Throw 'E_CONTENT_MISMATCH*'
            [System.IO.File]::ReadAllText($file) | Should -BeExactly 'original'

            # A trailing newline does not count as an extra line.
            Invoke-W365WriteFile -Root $root -CallArgs @{ path = 'g.txt'; content = "1`n2`n3`n"; expectLines = 3 } | Out-Null
            Invoke-W365WriteFile -Root $root -CallArgs @{ path = 'h.txt'; content = "1`r`n2"; expectLines = 2 } | Out-Null
        }
    }

    Context 'edit_file' {
        It 'AT-09 replaces a unique match' {
            $file = Join-Path $root 'e.ps1'
            [System.IO.File]::WriteAllText($file, "function A {`n    'old'`n}`n")
            $data = Invoke-W365EditFile -Root $root -CallArgs @{ path = 'e.ps1'; oldText = "'old'"; newText = "'new'" }
            [System.IO.File]::ReadAllText($file) | Should -BeExactly "function A {`n    'new'`n}`n"
            $data.replacements | Should -Be 1
        }
    }
}
