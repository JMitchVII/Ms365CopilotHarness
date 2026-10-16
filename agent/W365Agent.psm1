# W365 agent core: workspace path guard, tools and call dispatcher.
Set-StrictMode -Version Latest

# Resolves a tool-supplied path to a full path inside the workspace root, or throws E_PATH_ESCAPE.
function Resolve-WorkspacePath {
    param(
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][AllowEmptyString()][string]$Path
    )
    [System.IO.Path]::GetFullPath((Join-Path $Root $Path))
}

Export-ModuleMember -Function Resolve-WorkspacePath
