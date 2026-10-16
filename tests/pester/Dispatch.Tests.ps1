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

    It 'AD-03 never throws: coded errors keep their code, anything else is E_INTERNAL' {
        $escape = '{"id":"t3","tool":"read_file","args":{"path":"..\\x.txt"}}' | ConvertFrom-Json
        $r1 = Invoke-W365Call -Root $root -Call $escape
        $r1.ok | Should -BeFalse
        $r1.error.code | Should -Be 'E_PATH_ESCAPE'
        $r1.error.message | Should -Not -BeLike 'E_PATH_ESCAPE:*'

        Mock -ModuleName W365Agent Invoke-W365ListDir { throw 'disk on fire' }
        $r2 = Invoke-W365Call -Root $root -Call ('{"id":"t4","tool":"list_dir","args":{}}' | ConvertFrom-Json)
        $r2.ok | Should -BeFalse
        $r2.error.code | Should -Be 'E_INTERNAL'
        $r2.error.message | Should -BeLike '*disk on fire*'

        { Invoke-W365Call -Root $root -Call $null } | Should -Not -Throw
        (Invoke-W365Call -Root $root -Call $null).error.code | Should -Be 'E_BAD_ARGS'
    }

    It 'AD-04 always echoes the call id, on success and failure, for JSON objects and hashtables' {
        (Invoke-W365Call -Root $root -Call @{ id = 'h1'; tool = 'list_dir'; args = @{} }).id | Should -Be 'h1'
        (Invoke-W365Call -Root $root -Call @{ id = 'h2'; tool = 'nope'; args = @{} }).id | Should -Be 'h2'
        $json = '{"id":"h3","tool":"read_file","args":{"path":"missing"}}' | ConvertFrom-Json
        (Invoke-W365Call -Root $root -Call $json).id | Should -Be 'h3'
    }
}

BeforeDiscovery {
    $callFixtures = Get-ChildItem (Join-Path $PSScriptRoot '..\..\protocol\fixtures\calls') -Filter *.json |
        ForEach-Object { @{ Name = $_.BaseName; Fixture = (Get-Content -Raw $_.FullName | ConvertFrom-Json) } }
}

Describe 'Shared call fixtures' {
    It 'AD-06 <Name> gives the expected result shape' -ForEach $callFixtures {
        $root = Join-Path $TestDrive "fx-$Name"
        New-Item -ItemType Directory -Path $root -Force | Out-Null
        foreach ($p in $Fixture.setup.PSObject.Properties) {
            $file = Join-Path $root $p.Name
            New-Item -ItemType Directory -Path (Split-Path $file) -Force | Out-Null
            [System.IO.File]::WriteAllText($file, $p.Value)
        }

        # Round-trip through JSON, as the result would travel to the extension.
        $result = ConvertTo-Json -InputObject (Invoke-W365Call -Root $root -Call $Fixture.call) -Depth 10 | ConvertFrom-Json

        $result.id | Should -Be $Fixture.call.id
        $result.ok | Should -Be $Fixture.expected.ok
        if ($Fixture.expected.PSObject.Properties['code']) { $result.error.code | Should -Be $Fixture.expected.code }
        if ($Fixture.expected.PSObject.Properties['data']) {
            foreach ($p in $Fixture.expected.data.PSObject.Properties) {
                ConvertTo-Json -InputObject $result.data.($p.Name) -Depth 10 -Compress |
                    Should -Be (ConvertTo-Json -InputObject $p.Value -Depth 10 -Compress) -Because "data.$($p.Name)"
            }
        }
    }
}

Describe 'Get-W365Hello' {
    It 'AD-05 returns version, root and exactly the non-ui tools from protocol/tools.json' {
        $root = Join-Path $TestDrive 'ws'
        New-Item -ItemType Directory -Path $root -Force | Out-Null
        $spec = Get-Content -Raw (Join-Path $PSScriptRoot '..\..\protocol\tools.json') | ConvertFrom-Json
        $expected = @($spec.tools | Where-Object tier -ne 'ui' | ForEach-Object name | Sort-Object)

        $hello = Get-W365Hello -Root $root

        $hello.v | Should -Be 1
        $hello.kind | Should -Be 'hello'
        $hello.version | Should -Match '^\d+\.\d+\.\d+$'
        $hello.root | Should -Be ([System.IO.Path]::GetFullPath($root))
        @($hello.tools | Sort-Object) | Should -Be $expected
    }
}
