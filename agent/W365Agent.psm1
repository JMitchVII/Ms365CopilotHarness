# W365 agent core: workspace path guard, tools and call dispatcher.
Set-StrictMode -Version Latest

# Resolves a tool-supplied path to a full path inside the workspace root, or throws E_PATH_ESCAPE.
function Resolve-WorkspacePath {
    param(
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][AllowEmptyString()][string]$Path
    )
    $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
    $full = [System.IO.Path]::GetFullPath((Join-Path $rootFull $Path))
    $inside = $full -eq $rootFull -or $full.StartsWith($rootFull + '\', [System.StringComparison]::OrdinalIgnoreCase)
    if (-not $inside) { Throw-W365 'E_PATH_ESCAPE' "Path '$Path' is outside the workspace" }
    $full
}

# Errors carry their protocol code as a prefix: "E_CODE: message". The dispatcher turns them into results.
function Throw-W365 {
    param([string]$Code, [string]$Message)
    throw "${Code}: $Message"
}

Export-ModuleMember -Function Resolve-WorkspacePath
