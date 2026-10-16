BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..\..\agent\W365Agent.psm1') -Force

    # Builds a native-messaging frame: 4-byte little-endian length, then UTF-8 JSON.
    function New-Frame([string]$Json) {
        $body = [System.Text.Encoding]::UTF8.GetBytes($Json)
        [byte[]]([System.BitConverter]::GetBytes([int32]$body.Length) + $body)
    }

    # A stream that hands out at most 3 bytes per Read, like a pipe delivering a message in pieces.
    if (-not ('W365Test.ChunkyStream' -as [type])) {
        Add-Type -TypeDefinition @'
namespace W365Test {
    public class ChunkyStream : System.IO.MemoryStream {
        public ChunkyStream(byte[] data) : base(data) {}
        public override int Read(byte[] buffer, int offset, int count) {
            return base.Read(buffer, offset, System.Math.Min(count, 3));
        }
    }
}
'@
    }
}

Describe 'Read-NativeMessage' {
    It 'NF-01 reads a 4-byte little-endian length then the UTF-8 JSON body' {
        $stream = [System.IO.MemoryStream]::new((New-Frame '{"kind":"hello"}'))
        Read-NativeMessage -Stream $stream | Should -BeExactly '{"kind":"hello"}'
    }

    It 'NF-02 handles a message split across many reads' {
        $json = '{"kind":"call","id":"t1","tool":"list_dir","args":{}}'
        $stream = [W365Test.ChunkyStream]::new((New-Frame $json))
        Read-NativeMessage -Stream $stream | Should -BeExactly $json
    }

    It 'NF-03 returns $null on a clean end of stream (Chrome closed the port)' {
        $stream = [System.IO.MemoryStream]::new((New-Frame '{"a":1}'))
        Read-NativeMessage -Stream $stream | Out-Null
        Read-NativeMessage -Stream $stream | Should -BeExactly $null
        Read-NativeMessage -Stream ([System.IO.MemoryStream]::new()) | Should -BeExactly $null
    }

    It 'NF-04 throws a framing error when the header or body is cut short' {
        $frame = New-Frame '{"kind":"call"}'
        { Read-NativeMessage -Stream ([System.IO.MemoryStream]::new($frame[0..9])) } | Should -Throw '*E_TRANSPORT*'
        { Read-NativeMessage -Stream ([System.IO.MemoryStream]::new($frame[0..1])) } | Should -Throw '*E_TRANSPORT*'
    }
}

Describe 'Write-NativeMessage' {
    It 'NF-05 writes the correct length prefix and round-trips with Read-NativeMessage' {
        $json = '{"v":1,"kind":"result","id":"t1","ok":true}'
        $stream = [System.IO.MemoryStream]::new()
        Write-NativeMessage -Stream $stream -Json $json
        $bytes = $stream.ToArray()
        $bytes.Length | Should -Be ($json.Length + 4)
        [System.BitConverter]::ToInt32($bytes, 0) | Should -Be $json.Length

        $stream.Position = 0
        Read-NativeMessage -Stream $stream | Should -BeExactly $json
    }

    It 'NF-06 length counts UTF-8 bytes, not characters' {
        $json = "{`"t`":`"caf$([char]0xE9) $([char]0x65E5)`"}"
        $stream = [System.IO.MemoryStream]::new()
        Write-NativeMessage -Stream $stream -Json $json
        [System.BitConverter]::ToInt32($stream.ToArray(), 0) | Should -Be ([System.Text.Encoding]::UTF8.GetByteCount($json))
        $stream.Position = 0
        Read-NativeMessage -Stream $stream | Should -BeExactly $json
    }

    It 'NF-07 refuses messages over 1 MB (Chrome would drop the connection) with E_TOO_LARGE, writing nothing' {
        $json = '{"s":"' + ('x' * 1MB) + '"}'
        $stream = [System.IO.MemoryStream]::new()
        { Write-NativeMessage -Stream $stream -Json $json } | Should -Throw 'E_TOO_LARGE*'
        $stream.Length | Should -Be 0
    }
}
