BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..\..\agent\W365Agent.psm1') -Force

    # Builds a native-messaging frame: 4-byte little-endian length, then UTF-8 JSON.
    function New-Frame([string]$Json) {
        $body = [System.Text.Encoding]::UTF8.GetBytes($Json)
        [byte[]]([System.BitConverter]::GetBytes([int32]$body.Length) + $body)
    }
}

Describe 'Read-NativeMessage' {
    It 'NF-01 reads a 4-byte little-endian length then the UTF-8 JSON body' {
        $stream = [System.IO.MemoryStream]::new((New-Frame '{"kind":"hello"}'))
        Read-NativeMessage -Stream $stream | Should -BeExactly '{"kind":"hello"}'
    }
}
