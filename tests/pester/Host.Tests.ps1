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

Describe 'host.ps1 process' {
    It 'NH-03 writes nothing but framed messages to stdout, even when PowerShell output streams are noisy' {
        $root = Join-Path $TestDrive 'proc-ws'
        New-Item -ItemType Directory -Path $root -Force | Out-Null
        $hostScript = Join-Path $PSScriptRoot '..\..\agent\host.ps1'

        $psi = [System.Diagnostics.ProcessStartInfo]::new('powershell.exe',
            "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$hostScript`" chrome-extension://abc/ --parent-window=0")
        $psi.UseShellExecute = $false
        $psi.RedirectStandardInput = $true
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.EnvironmentVariables['W365_ROOT'] = $root
        $psi.EnvironmentVariables['W365_HOST_NOISE'] = '1'
        $psi.EnvironmentVariables['W365_LOG'] = Join-Path $TestDrive 'proc-host.log'
        $proc = [System.Diagnostics.Process]::Start($psi)
        $stdout = [System.IO.MemoryStream]::new()
        $copy = $proc.StandardOutput.BaseStream.CopyToAsync($stdout)
        $stderr = $proc.StandardError.ReadToEndAsync()

        $in = New-InputStream @(
            '{"v":1,"kind":"hello"}'
            '{"v":1,"kind":"call","id":"r1","tool":"run_ps","args":{"command":"Write-Host loud; Write-Output quiet"}}'
            '{"v":1,"kind":"call","id":"r2","tool":"read_file","args":{"path":"missing.txt"}}'
        )
        $in.CopyTo($proc.StandardInput.BaseStream)
        $proc.StandardInput.Close()
        $proc.WaitForExit(30000) | Should -BeTrue
        $copy.Wait(5000) | Out-Null

        $messages = @(Read-AllMessages $stdout)
        $stdout.Position | Should -Be $stdout.Length -Because 'no stray bytes after the last frame'
        $messages.Count | Should -Be 3 -Because "stderr was: $($stderr.Result)"
        $messages[0].kind | Should -Be 'hello'
        $messages[0].root | Should -Be ([System.IO.Path]::GetFullPath($root))
        $messages[1].data.stdout | Should -BeLike '*loud*'
        $messages[2].error.code | Should -Be 'E_NOT_FOUND'
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

    It 'NH-02 answers hello and several calls in order' {
        $in = New-InputStream @(
            '{"v":1,"kind":"hello"}'
            '{"v":1,"kind":"call","id":"a","tool":"write_file","args":{"path":"x.txt","content":"1"}}'
            '{"v":1,"kind":"call","id":"b","tool":"read_file","args":{"path":"x.txt"}}'
            '{"v":1,"kind":"call","id":"c","tool":"list_dir","args":{}}'
        )
        $out = [System.IO.MemoryStream]::new()

        Invoke-W365HostLoop -Root $root -InStream $in -OutStream $out -LogPath $log

        $messages = @(Read-AllMessages $out)
        $messages.Count | Should -Be 4
        $messages[0].kind | Should -Be 'hello'
        $messages[0].tools | Should -Contain 'read_file'
        @($messages[1..3].id) | Should -Be @('a', 'b', 'c')
        $messages[2].data.content | Should -Be "1`t1"
    }

    It 'NH-04 a malformed frame or an oversized result gives an error result and the loop carries on' {
        $big = 'y' * (2MB)
        [System.IO.File]::WriteAllText((Join-Path $root 'big.txt'), $big)
        $in = New-InputStream @(
            '{"v":1,"kind":"call", this is not json'
            '{"v":1,"kind":"call","id":"big","tool":"read_file","args":{"path":"big.txt"}}'
            '{"v":1,"kind":"call","id":"ok","tool":"list_dir","args":{}}'
        )
        $out = [System.IO.MemoryStream]::new()

        Invoke-W365HostLoop -Root $root -InStream $in -OutStream $out -LogPath $log

        $messages = @(Read-AllMessages $out)
        $messages.Count | Should -Be 3
        $messages[0].ok | Should -BeFalse
        $messages[0].error.code | Should -Be 'E_PARSE'
        $messages[1].id | Should -Be 'big'
        $messages[1].error.code | Should -Be 'E_TOO_LARGE'
        $messages[2].id | Should -Be 'ok'
        $messages[2].ok | Should -BeTrue
    }

    It 'NH-05 errors go to the log file, not the output stream' {
        $in = New-InputStream '{broken'
        $out = [System.IO.MemoryStream]::new()
        Invoke-W365HostLoop -Root $root -InStream $in -OutStream $out -LogPath $log
        Get-Content $log -Raw | Should -BeLike '*E_PARSE*'
    }
}
