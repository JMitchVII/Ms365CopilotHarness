BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..\..\agent\W365Agent.psm1') -Force
}

Describe 'Invoke-W365Call' {
    BeforeEach {
        $script:root = Join-Path $TestDrive 'ws'
        Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
        New-Item -ItemType Directory -Path $root -Force | Out-Null
    }

    It 'AD-01 routes read_file to the read tool and returns ok with data' {
        [System.IO.File]::WriteAllText((Join-Path $root 'a.txt'), 'hello')
        $call = '{"id":"t1","tool":"read_file","args":{"path":"a.txt"}}' | ConvertFrom-Json

        $result = Invoke-W365Call -Root $root -Call $call

        $result.ok | Should -BeTrue
        $result.data.content | Should -Be "1`thello"
    }

    It 'AD-02 unknown tool returns ok:false with E_UNKNOWN_TOOL' {
        $call = '{"id":"t2","tool":"format_disk","args":{}}' | ConvertFrom-Json
        $result = Invoke-W365Call -Root $root -Call $call
        $result.ok | Should -BeFalse
        $result.error.code | Should -Be 'E_UNKNOWN_TOOL'
        $result.error.message | Should -BeLike '*format_disk*'
    }
}
