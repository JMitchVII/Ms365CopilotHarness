# W365 agent core: workspace path guard, tools and call dispatcher.
Set-StrictMode -Version Latest

$script:AgentVersion = '0.1.0'

# Errors carry their protocol code as a prefix: "E_CODE: message". The dispatcher turns them into results.
function Throw-W365 {
    param([string]$Code, [string]$Message)
    throw "${Code}: $Message"
}

function Test-InsideRoot {
    param([string]$RootFull, [string]$Full)
    $Full -eq $RootFull -or $Full.StartsWith($RootFull + '\', [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-FullPath {
    param([string]$Base, [string]$Path)
    try {
        [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($Base, $Path)).TrimEnd('\')
    } catch {
        Throw-W365 'E_BAD_ARGS' "Invalid path '$Path'"
    }
}

# Resolves a tool-supplied path to a full path inside the workspace root, or throws E_PATH_ESCAPE.
function Resolve-WorkspacePath {
    param(
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][AllowEmptyString()][string]$Path
    )
    $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
    $full = Get-FullPath $rootFull $Path
    if (-not (Test-InsideRoot $rootFull $full)) { Throw-W365 'E_PATH_ESCAPE' "Path '$Path' is outside the workspace" }

    # Junctions and symlinks inside the root could lead outside it: check every existing segment.
    $current = $rootFull
    foreach ($segment in $full.Substring($rootFull.Length).Split('\', [System.StringSplitOptions]::RemoveEmptyEntries)) {
        $current = Join-Path $current $segment
        $item = Get-Item -LiteralPath $current -Force -ErrorAction SilentlyContinue
        if (-not $item) { break }
        if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            $target = @($item.Target)[0]
            if (-not $target) { Throw-W365 'E_PATH_ESCAPE' "Path '$Path' goes through a link that can't be resolved" }
            if (-not (Test-InsideRoot $rootFull (Get-FullPath (Split-Path $current) $target))) {
                Throw-W365 'E_PATH_ESCAPE' "Path '$Path' goes through a link outside the workspace"
            }
        }
    }
    $full
}

# Reads an argument from a hashtable or a PSCustomObject (ConvertFrom-Json output), with a default.
function Get-CallArg {
    param($CallArgs, [string]$Name, $Default = $null)
    if ($null -eq $CallArgs) { return $Default }
    if ($CallArgs -is [System.Collections.IDictionary]) {
        if ($CallArgs.Contains($Name)) { return $CallArgs[$Name] }
        return $Default
    }
    $prop = $CallArgs.PSObject.Properties[$Name]
    if ($prop) { return $prop.Value }
    $Default
}

function Invoke-W365ListDir {
    param([Parameter(Mandatory)][string]$Root, $CallArgs)
    $rel = Get-CallArg $CallArgs 'path' '.'
    $full = Resolve-WorkspacePath -Root $Root -Path $rel
    if (-not (Test-Path -LiteralPath $full -PathType Container)) { Throw-W365 'E_NOT_FOUND' "No directory '$rel'" }
    $entries = @(Get-ChildItem -LiteralPath $full -Force | Sort-Object Name | ForEach-Object {
        if ($_.PSIsContainer) {
            [ordered]@{ name = $_.Name; type = 'dir' }
        } else {
            [ordered]@{ name = $_.Name; type = 'file'; size = $_.Length }
        }
    })
    [ordered]@{ path = $rel; entries = $entries }
}

function Invoke-W365ReadFile {
    param([Parameter(Mandatory)][string]$Root, $CallArgs)
    $rel = Get-CallArg $CallArgs 'path'
    $full = Resolve-WorkspacePath -Root $Root -Path $rel
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { Throw-W365 'E_NOT_FOUND' "No file '$rel'" }
    $offset =[Math]::Max(1, [int](Get-CallArg $CallArgs 'offset' 1))
    $limit = [Math]::Max(1, [int](Get-CallArg $CallArgs 'limit' 2000))
    $lines = [System.IO.File]::ReadAllText($full) -split '\r?\n'
    $end = [Math]::Min($lines.Count, $offset + $limit - 1)
    $numbered = for ($i = $offset; $i -le $end; $i++) { "$i`t$($lines[$i - 1])" }
    [ordered]@{
        path = $rel; content = (@($numbered) -join "`n")
        startLine = $offset; endLine = $end; totalLines = $lines.Count
    }
}

$script:Utf8NoBom = [System.Text.UTF8Encoding]::new($false)

# Writes text as UTF-8 without BOM, exactly as given (line endings untouched), creating parent folders.
function Write-WorkspaceText {
    param([string]$Full, [string]$Text)
    $parent = Split-Path -Parent $Full
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    [System.IO.File]::WriteAllText($Full, $Text, $script:Utf8NoBom)
}

function Measure-Lines {
    param([string]$Text)
    if ($Text -eq '') { return 0 }
    $count = ($Text -split '\r?\n').Count
    if ($Text -match '\n$') { $count-- }
    $count
}

# Copilot can mangle content in transit. If it told us how many lines it meant to send, check before writing.
function Assert-ExpectLines {
    param($CallArgs, [string]$Text)
    $expect = Get-CallArg $CallArgs 'expectLines'
    if ($null -eq $expect) { return }
    $actual = Measure-Lines $Text
    if ($actual -ne [int]$expect) {
        Throw-W365 'E_CONTENT_MISMATCH' "Content has $actual lines but expectLines is $expect. Resend the full content."
    }
}

function Invoke-W365WriteFile {
    param([Parameter(Mandatory)][string]$Root, $CallArgs)
    $rel = Get-CallArg $CallArgs 'path'
    $content = [string](Get-CallArg $CallArgs 'content' '')
    $full = Resolve-WorkspacePath -Root $Root -Path $rel
    Assert-ExpectLines $CallArgs $content
    Write-WorkspaceText $full $content
    [ordered]@{ path = $rel; bytes = $script:Utf8NoBom.GetByteCount($content) }
}

function Measure-Occurrences {
    param([string]$Text, [string]$Find)
    $count = 0
    $at = $Text.IndexOf($Find, [System.StringComparison]::Ordinal)
    while ($at -ge 0) {
        $count++
        $at = $Text.IndexOf($Find, $at + $Find.Length, [System.StringComparison]::Ordinal)
    }
    $count
}

function Invoke-W365EditFile {
    param([Parameter(Mandatory)][string]$Root, $CallArgs)
    $rel = Get-CallArg $CallArgs 'path'
    $oldText = [string](Get-CallArg $CallArgs 'oldText')
    $newText = [string](Get-CallArg $CallArgs 'newText')
    $full = Resolve-WorkspacePath -Root $Root -Path $rel
    if ($oldText -eq '') { Throw-W365 'E_BAD_ARGS' 'oldText must not be empty' }
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { Throw-W365 'E_NOT_FOUND' "No file '$rel'" }
    Assert-ExpectLines $CallArgs $newText
    $text = [System.IO.File]::ReadAllText($full)
    $count = Measure-Occurrences $text $oldText
    if ($count -eq 0 -and $text.Contains("`r`n") -and $oldText -match '(?<!\r)\n') {
        # Copilot sends LF line endings; match a CRLF file by converting both sides.
        $oldText = $oldText -replace '(?<!\r)\n', "`r`n"
        $newText = $newText -replace '(?<!\r)\n', "`r`n"
        $count = Measure-Occurrences $text $oldText
    }
    if ($count -eq 0) { Throw-W365 'E_EDIT_NO_MATCH' "oldText was not found in '$rel'. Read the file and copy the text exactly." }
    if ($count -gt 1 -and -not [bool](Get-CallArg $CallArgs 'replaceAll' $false)) {
        Throw-W365 'E_EDIT_AMBIGUOUS' "oldText matches $count places in '$rel'. Include more context, or set replaceAll."
    }
    Write-WorkspaceText $full $text.Replace($oldText, $newText)
    [ordered]@{ path = $rel; replacements = $count }
}

# All files under a folder, sorted, without descending into junctions or symlinked folders.
function Get-WorkspaceFiles {
    param([string]$Dir)
    $files = [System.Collections.Generic.List[System.IO.FileInfo]]::new()
    $pending = [System.Collections.Generic.Stack[string]]::new()
    $pending.Push($Dir)
    while ($pending.Count -gt 0) {
        foreach ($item in Get-ChildItem -LiteralPath $pending.Pop() -Force -ErrorAction SilentlyContinue) {
            if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { continue }
            if ($item.PSIsContainer) { $pending.Push($item.FullName) } else { $files.Add($item) }
        }
    }
    $files | Sort-Object FullName
}

function Invoke-W365Search {
    param([Parameter(Mandatory)][string]$Root, $CallArgs)
    $pattern = [string](Get-CallArg $CallArgs 'pattern')
    $rootFull = Resolve-WorkspacePath -Root $Root -Path ''
    $dir = Resolve-WorkspacePath -Root $Root -Path (Get-CallArg $CallArgs 'path' '.')
    $glob = Get-CallArg $CallArgs 'glob' '*'
    $max = [Math]::Max(1, [int](Get-CallArg $CallArgs 'maxResults' 100))
    $found = [System.Collections.Generic.List[object]]::new()
    $truncated = $false
    foreach ($file in Get-WorkspaceFiles $dir | Where-Object Name -like $glob) {
        $rel = $file.FullName.Substring($rootFull.Length + 1)
        foreach ($m in Select-String -LiteralPath $file.FullName -Pattern $pattern -Encoding UTF8) {
            if ($found.Count -ge $max) { $truncated = $true; break }
            $found.Add([ordered]@{ file = $rel; line = $m.LineNumber; text = $m.Line })
        }
        if ($truncated) { break }
    }
    [ordered]@{ pattern = $pattern; matches = $found.ToArray(); truncated = $truncated }
}

# Runs a command in a separate powershell.exe so it can't touch the agent's stdout (the native messaging pipe).
# -EncodedCommand is used because the machine's ExecutionPolicy doesn't block it.
# Keeps the start and end of long output (errors and summaries are usually at the end).
function Limit-Output {
    param([string]$Text, [int]$Max)
    if ($Text.Length -le $Max) { return $Text, $false }
    $head = [int]($Max * 0.2)
    $tail = $Max - $head
    $omitted = $Text.Length - $head - $tail
    ($Text.Substring(0, $head) + "`n... [$omitted characters omitted] ...`n" + $Text.Substring($Text.Length - $tail)), $true
}

function Invoke-W365RunPs {
    param([Parameter(Mandatory)][string]$Root, $CallArgs, [int]$MaxOutputChars = 100000)
    $command = [string](Get-CallArg $CallArgs 'command')
    $rootFull = Resolve-WorkspacePath -Root $Root -Path ''
    $script = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; `$ProgressPreference = 'SilentlyContinue'`n" + $command
    $encoded = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($script))

    $psi = [System.Diagnostics.ProcessStartInfo]::new('powershell.exe',
        "-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $encoded")
    $psi.WorkingDirectory = $rootFull
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8

    $proc = [System.Diagnostics.Process]::Start($psi)
    try {
        $proc.StandardInput.Close()
        $stdout = $proc.StandardOutput.ReadToEndAsync()
        $stderr = $proc.StandardError.ReadToEndAsync()
        $timeoutSec = [Math]::Max(1, [int](Get-CallArg $CallArgs 'timeoutSec' 120))
        if (-not $proc.WaitForExit($timeoutSec * 1000)) {
            # Kill the whole tree: children could otherwise keep running and hold our pipes open.
            & taskkill.exe /T /F /PID $proc.Id 2>&1 | Out-Null
            $proc.WaitForExit(5000) | Out-Null
            Throw-W365 'E_TIMEOUT' "Command still running after $timeoutSec s and was stopped"
        }
        $proc.WaitForExit()  # flushes async output
        $out, $outCut = Limit-Output $stdout.Result $MaxOutputChars
        $err, $errCut = Limit-Output $stderr.Result $MaxOutputChars
        [ordered]@{ exitCode = $proc.ExitCode; stdout = $out; stderr = $err; truncated = ($outCut -or $errCut) }
    } finally {
        $proc.Dispose()
    }
}

$script:Handlers = @{
    list_dir   = 'Invoke-W365ListDir'
    read_file  = 'Invoke-W365ReadFile'
    search     = 'Invoke-W365Search'
    write_file = 'Invoke-W365WriteFile'
    edit_file  = 'Invoke-W365EditFile'
    run_ps     = 'Invoke-W365RunPs'
}

function New-ErrorResult {
    param($Id, [string]$Code, [string]$Message)
    [ordered]@{ id = $Id; ok = $false; error = [ordered]@{ code = $Code; message = $Message } }
}

# Runs one call ({id, tool, args}) and returns its result. Never throws: every failure becomes ok:false.
function Invoke-W365Call {
    param([Parameter(Mandatory)][string]$Root, [AllowNull()]$Call)
    if ($null -eq $Call) { return New-ErrorResult $null 'E_BAD_ARGS' 'Call must be an object with id, tool and args' }
    $id = $Call.id
    $handler = $script:Handlers[[string]$Call.tool]
    if (-not $handler) { return New-ErrorResult $id 'E_UNKNOWN_TOOL' "Unknown tool '$($Call.tool)'" }
    try {
        $data = & $handler -Root $Root -CallArgs $Call.args
        [ordered]@{ id = $id; ok = $true; data = $data }
    } catch {
        $message = $_.Exception.Message
        if ($message -match '(?s)^(E_[A-Z_]+): (.*)$') {
            New-ErrorResult $id $Matches[1] $Matches[2]
        } else {
            New-ErrorResult $id 'E_INTERNAL' $message
        }
    }
}

# First message on every connection: tells the extension who we are and what we can run.
function Get-W365Hello {
    param([Parameter(Mandatory)][string]$Root)
    [ordered]@{
        v       = 1
        kind    = 'hello'
        version = $script:AgentVersion
        root    = Resolve-WorkspacePath -Root $Root -Path ''
        tools   = @($script:Handlers.Keys | Sort-Object)
    }
}

Export-ModuleMember -Function Resolve-WorkspacePath, Invoke-W365ListDir, Invoke-W365ReadFile, Invoke-W365WriteFile,
    Invoke-W365EditFile, Invoke-W365Search, Invoke-W365RunPs, Invoke-W365Call, Get-W365Hello
