BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..\..\agent\W365Agent.psm1') -Force

    function Write-Inbox([string]$Name, [string]$Json) {
        [System.IO.File]::WriteAllText((Join-Path $shared "inbox\$Name"), $Json)
    }
    function Read-Outbox([string]$Name) {
        Get-Content -Raw (Join-Path $shared "outbox\$Name") | ConvertFrom-Json
    }
}

Describe 'File transport loop' {
    BeforeEach {
        $script:root = Join-Path $TestDrive 'ws'
        $script:shared = Join-Path $TestDrive 'shared'
        Remove-Item $root, $shared -Recurse -Force -ErrorAction SilentlyContinue
        New-Item -ItemType Directory -Path $root, "$shared\inbox", "$shared\outbox" -Force | Out-Null
    }

    It 'FL-01 picks up an inbox call, writes the result to outbox under the same file name and removes the inbox file' {
        [System.IO.File]::WriteAllText((Join-Path $root 'a.txt'), 'hi')
        Write-Inbox 't1.json' '{"v":1,"kind":"call","id":"t1","tool":"read_file","args":{"path":"a.txt"}}'

        Invoke-W365FileLoopOnce -Root $root -SharedDir $shared

        $result = Read-Outbox 't1.json'
        $result.kind | Should -Be 'result'
        $result.id | Should -Be 't1'
        $result.data.content | Should -Be "1`thi"
        Test-Path (Join-Path $shared 'inbox\t1.json') | Should -BeFalse
    }
}
