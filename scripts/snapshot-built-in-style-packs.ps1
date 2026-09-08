param(
    [string]$ProfileRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path,
    [string[]]$PackNames = @('Seraphina', 'Anomalous')
)

$ErrorActionPreference = 'Stop'
$extensionRoot = Split-Path -Parent $PSScriptRoot
$assetRoot = Join-Path $extensionRoot 'assets\style-packs'
$settingsPath = Join-Path $ProfileRoot 'settings.json'
$sidecarPath = Join-Path $ProfileRoot 'user\files\uibedazzler_meta.json'
$settings = Get-Content -Raw -LiteralPath $settingsPath | ConvertFrom-Json
$sidecar = Get-Content -Raw -LiteralPath $sidecarPath | ConvertFrom-Json
$allStyles = @($settings.extension_settings.UIBedazzler.chatDesign.styles)
$allIconSets = @($sidecar.customTopbarIcons.sets.PSObject.Properties)

function Get-CategoryKey($style) {
    if ($style.element -ne 'generalUi') { return $style.element }
    $section = if ($style.uiSection -eq 'integrations') { 'integrations' } else { 'native' }
    return "generalUi:$section"
}

$categoryOrder = @(
    'dialogue', 'banner', 'container', 'avatar',
    'generalUi:native', 'generalUi:integrations', 'background'
)

foreach ($packName in $PackNames) {
    $styles = @($allStyles | Where-Object {
        $_.name -eq $packName -and $_.element -in @('dialogue', 'banner', 'container', 'avatar', 'generalUi', 'background')
    })
    $grouped = @($styles | Group-Object { Get-CategoryKey $_ })
    if ($styles.Count -ne $categoryOrder.Count -or @($grouped | Where-Object Count -ne 1).Count -gt 0) {
        throw "$packName must have exactly one current style in each portable category, including both General UI sections."
    }
    $missing = @($categoryOrder | Where-Object { $_ -notin $grouped.Name })
    if ($missing.Count) { throw "$packName is missing: $($missing -join ', ')" }

    $styleBlocks = @($categoryOrder | ForEach-Object {
        $category = $_
        $style = $styles | Where-Object { (Get-CategoryKey $_) -eq $category } | Select-Object -First 1
        $block = [ordered]@{
            element = $style.element
            properties = $style.properties
        }
        if ($style.element -eq 'generalUi') { $block.uiSection = $style.uiSection }
        [pscustomobject]$block
    })

    $iconMatches = @($allIconSets | Where-Object { $_.Value.name -eq $packName })
    if ($iconMatches.Count -ne 1) { throw "$packName must have exactly one matching custom top-bar icon set." }
    $iconSet = $iconMatches[0].Value
    $resourceSlots = [ordered]@{}
    $packFolder = Join-Path $assetRoot $packName.ToLowerInvariant()
    $iconFolder = Join-Path $packFolder 'icons'
    New-Item -ItemType Directory -Path $packFolder -Force | Out-Null

    foreach ($slot in $iconSet.slots.PSObject.Properties) {
        $entry = $slot.Value
        if ($entry.source -ne 'url' -or $entry.value -match '^https?://') {
            $resourceSlots[$slot.Name] = [ordered]@{
                source = $entry.source
                value = $entry.value
                render = $entry.render
            }
            continue
        }

        $relativeSource = ([string]$entry.value).TrimStart('/') -replace '/', '\'
        if ($relativeSource -notlike 'user\images\icons\*') {
            throw "$packName icon $($slot.Name) is outside user/images/icons and cannot be bundled."
        }
        $sourcePath = Join-Path $ProfileRoot $relativeSource
        $extension = [IO.Path]::GetExtension($sourcePath).TrimStart('.').ToLowerInvariant()
        if ($extension -eq 'jpg') { $format = 'jpeg' } else { $format = $extension }
        if ($format -notin @('bmp', 'gif', 'jpeg', 'png', 'webp')) {
            throw "$packName icon $($slot.Name) uses an unsupported image format."
        }
        New-Item -ItemType Directory -Path $iconFolder -Force | Out-Null
        $archiveExtension = if ($format -eq 'jpeg') { 'jpg' } else { $format }
        $filename = "$($slot.Name).$archiveExtension"
        Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $iconFolder $filename) -Force
        $resourceSlots[$slot.Name] = [ordered]@{
            source = 'archive'
            path = "icons/$filename"
            format = $format
            render = $entry.render
        }
    }

    $themeSource = Join-Path $ProfileRoot "themes\$packName.json"
    if (-not (Test-Path -LiteralPath $themeSource)) { throw "Missing saved theme: $themeSource" }
    $themeFolder = Join-Path $packFolder 'theme'
    New-Item -ItemType Directory -Path $themeFolder -Force | Out-Null
    Copy-Item -LiteralPath $themeSource -Destination (Join-Path $themeFolder 'theme.json') -Force

    $manifest = [ordered]@{
        format = 'uibedazzler-style-pack'
        schemaVersion = 2
        name = $packName
        styles = $styleBlocks
        resources = [ordered]@{
            customTopbarIcons = [ordered]@{
                schemaVersion = 1
                name = $packName
                baseSet = $iconSet.baseSet
                hover = $iconSet.hover
                slots = $resourceSlots
            }
            theme = [ordered]@{
                schemaVersion = 1
                name = $packName
                path = 'theme/theme.json'
            }
        }
    }
    $json = $manifest | ConvertTo-Json -Depth 40
    Set-Content -LiteralPath (Join-Path $packFolder 'pack.json') -Value $json -Encoding utf8
    Write-Output "Snapshotted $packName ($($styleBlocks.Count) styles, $($resourceSlots.Count) icons)."
}
