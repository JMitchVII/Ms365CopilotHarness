BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..\..\agent\W365Agent.psm1') -Force

    function New-InputStream([string[]]$Messages) {
        $s = [System.IO.MemoryStream]::new()
        foreach ($m in $Messages) { Write-NativeMessage -Stream $s -Json $m }
        $s.Position = 0
        $s
    }

    function Read-AllMessages([System.IO.MemoryStream]$Stream) {
        $Stream.Position = 0
        while ($null -ne ($json = Read-NativeMessage -Stream $Stream)) { $json | ConvertFrom-Json }
    }
}

Describe 'Invoke-W365HostLoop' {
    BeforeEach {
        $script:root = Join-Path $TestDrive 'ws'
        Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
        New-Item -ItemType Directory -Path $root -Force | Out-Null
        $script:log = Join-Path $TestDrive 'host.log'
    }

    It 'NH-01 answers one framed call with one framed result, then returns at end of input' {
        [System.IO.File]::WriteAllText((Join-Path $root 'a.txt'), 'hi')
        $in = New-InputStream '{"v":1,"kind":"call","id":"t1","tool":"read_file","args":{"path":"a.txt"}}'
        $out = [System.IO.MemoryStream]::new()

        Invoke-W365HostLoop -Root $root -InStream $in -OutStream $out -LogPath $log

        $results = @(Read-AllMessages $out)
        $results.Count | Should -Be 1
        $results[0].v | Should -Be 1
        $results[0].kind | Should -Be 'result'
        $results[0].id | Should -Be 't1'
        $results[0].ok | Should -BeTrue
        $results[0].data.content | Should -Be "1`thi"
    }
}
