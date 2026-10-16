# W365 agent core: workspace path guard, tools and call dispatcher.
Set-StrictMode -Version Latest

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

Export-ModuleMember -Function Resolve-WorkspacePath, Invoke-W365ListDir, Invoke-W365ReadFile, Invoke-W365WriteFile,
    Invoke-W365EditFile
