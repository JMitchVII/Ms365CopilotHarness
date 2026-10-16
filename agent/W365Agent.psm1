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
    $entries = @(Get-ChildItem -LiteralPath $full -Force | Sort-Object Name | ForEach-Object {
        if ($_.PSIsContainer) {
            [ordered]@{ name = $_.Name; type = 'dir' }
        } else {
            [ordered]@{ name = $_.Name; type = 'file'; size = $_.Length }
        }
    })
    [ordered]@{ path = $rel; entries = $entries }
}

Export-ModuleMember -Function Resolve-WorkspacePath, Invoke-W365ListDir
