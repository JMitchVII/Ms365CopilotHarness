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

    It 'FL-02 ignores files still being written (.tmp, Chrome .crswap)' {
        Write-Inbox 'a.json.tmp' '{"v":1,"kind":"call","id":"a"'
        Write-Inbox 'b.json.crswap' '{"v":1,"kind":"call","id":"b"'
        Invoke-W365FileLoopOnce -Root $root -SharedDir $shared
        @(Get-ChildItem (Join-Path $shared 'outbox')).Count | Should -Be 0
        @(Get-ChildItem (Join-Path $shared 'inbox')).Count | Should -Be 2
    }

    It 'FL-03 writes the outbox file atomically (temp file, then rename) so readers never see half a result' {
        Mock -ModuleName W365Agent Move-Item {
            $script:moved = "$LiteralPath -> $Destination"
            Microsoft.PowerShell.Management\Move-Item -LiteralPath $LiteralPath -Destination $Destination -Force
        }
        Write-Inbox 'c.json' '{"v":1,"kind":"call","id":"c","tool":"list_dir","args":{}}'
        Invoke-W365FileLoopOnce -Root $root -SharedDir $shared
        Should -Invoke -ModuleName W365Agent Move-Item -Times 1
        $script:moved | Should -BeLike '*outbox*c.json.tmp -> *outbox*c.json'
        (Read-Outbox 'c.json').id | Should -Be 'c'
    }

    It 'FL-04 processes several inbox files oldest first' {
        $base = (Get-Date).AddMinutes(-10)
        foreach ($entry in @(@{ n = 'z-first'; m = 0 }, @{ n = 'a-second'; m = 1 }, @{ n = 'm-third'; m = 2 })) {
            $body = '{"v":1,"kind":"call","id":"' + $entry.n + '","tool":"write_file","args":{"path":"order.txt","content":"' + $entry.n + '"}}'
            Write-Inbox "$($entry.n).json" $body
            (Get-Item (Join-Path $shared "inbox\$($entry.n).json")).LastWriteTime = $base.AddSeconds($entry.m)
        }
        Mock -ModuleName W365Agent Get-HostReply { $script:order += @(($Json | ConvertFrom-Json).id); '{}' }
        $script:order = @()

        Invoke-W365FileLoopOnce -Root $root -SharedDir $shared

        $script:order | Should -Be @('z-first', 'a-second', 'm-third')
    }

    It 'FL-05 a corrupt inbox file gets an error result in the outbox and the loop carries on' {
        Write-Inbox 'bad.json' '{"v":1, this is not json'
        Write-Inbox 'good.json' '{"v":1,"kind":"call","id":"good","tool":"list_dir","args":{}}'
        Invoke-W365FileLoopOnce -Root $root -SharedDir $shared
        (Read-Outbox 'bad.json').error.code | Should -Be 'E_PARSE'
        (Read-Outbox 'good.json').ok | Should -BeTrue
        @(Get-ChildItem (Join-Path $shared 'inbox')).Count | Should -Be 0
    }

    It 'FL-06 the loop keeps a heartbeat file fresh so the extension can show "agent alive"' {
        New-Item -ItemType File -Path (Join-Path $shared 'stop') | Out-Null
        Start-W365FileLoop -Root $root -SharedDir $shared -PollMs 50 -MaxSeconds 10
        $beat = Get-Content -Raw (Join-Path $shared 'heartbeat.json') | ConvertFrom-Json
        ((Get-Date).ToUniversalTime() - [datetime]::Parse($beat.at).ToUniversalTime()).TotalSeconds | Should -BeLessThan 5
        $beat.pid | Should -Be $PID
    }

    It 'FL-07 the loop processes pending work, then stops cleanly when a stop file appears' {
        Write-Inbox 'last.json' '{"v":1,"kind":"call","id":"last","tool":"list_dir","args":{}}'
        New-Item -ItemType File -Path (Join-Path $shared 'stop') | Out-Null
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        Start-W365FileLoop -Root $root -SharedDir $shared -PollMs 50 -MaxSeconds 10
        $sw.Elapsed.TotalSeconds | Should -BeLessThan 5
        (Read-Outbox 'last.json').ok | Should -BeTrue
        Test-Path (Join-Path $shared 'stop') | Should -BeFalse -Because 'the stop file is consumed'
    }
}
