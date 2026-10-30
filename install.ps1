# Universal Installer & Linker for token-diet (Antigravity & ZCode)
[CmdletBinding()]
param(
    [switch]$Uninstall
)

$repoRoot = $PSScriptRoot
$pluginSrc = Join-Path $repoRoot "plugins\token-diet"

$targets = @(
    (Join-Path $env:USERPROFILE ".gemini\config\plugins\token-diet"),
    (Join-Path $env:USERPROFILE ".zcode\plugins\token-diet")
)

if ($Uninstall) {
    foreach ($target in $targets) {
        if (Test-Path $target) {
            Write-Host "Removing link: $target" -ForegroundColor Yellow
            $item = Get-Item $target -Force
            if ($item.Attributes -match "ReparsePoint") {
                [System.IO.Directory]::Delete($target)
            } else {
                Remove-Item -Path $target -Recurse -Force
            }
        }
    }
    Write-Host "token-diet unlinked successfully." -ForegroundColor Green
    exit 0
}

Write-Host "Linking token-diet from $pluginSrc..." -ForegroundColor Cyan

foreach ($target in $targets) {
    $parent = Split-Path $target -Parent
    if (!(Test-Path $parent)) {
        New-Item -Path $parent -ItemType Directory -Force | Out-Null
    }

    if (Test-Path $target) {
        $item = Get-Item $target -Force
        if ($item.Attributes -match "ReparsePoint") {
            Write-Host "Junction already exists at $target" -ForegroundColor Gray
            continue
        } else {
            Write-Host "Replacing existing static directory with junction at $target..." -ForegroundColor Yellow
            Remove-Item -Path $target -Recurse -Force
        }
    }

    try {
        New-Item -ItemType Junction -Path $target -Target $pluginSrc | Out-Null
        Write-Host "Linked Junction: $target -> $pluginSrc" -ForegroundColor Green
    } catch {
        Write-Warning "Could not create junction, falling back to copy: $_"
        Copy-Item -Path $pluginSrc -Destination $target -Recurse -Force
        Write-Host "Copied to: $target" -ForegroundColor Green
    }
}

Write-Host "`ntoken-diet is now active across both Antigravity and ZCode!" -ForegroundColor Green
