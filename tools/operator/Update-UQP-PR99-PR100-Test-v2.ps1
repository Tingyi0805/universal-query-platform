# UQP PR99+PR100 Windows pre-production direct update.
# Package format v2: the GitHub Actions artifact ZIP directly contains payload/,
# sql/, SHA256SUMS.csv, and this installer (no nested ZIP).
# Operator must apply 929 to the existing EINOV-VPN/UniversalQueryPlatform DB first.
[CmdletBinding()]
param(
    [string]$PackageRoot = $PSScriptRoot,
    [string]$Target = 'C:\UQP',
    [switch]$IConfirmThisIsTestOnly
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $IConfirmThisIsTestOnly) { throw 'TEST_ONLY_CONFIRMATION_REQUIRED' }
if ($Target.TrimEnd('\') -ine 'C:\UQP') { throw 'TARGET_PATH_MISMATCH' }
if (-not (Test-Path -LiteralPath $PackageRoot -PathType Container)) { throw 'PACKAGE_ROOT_NOT_FOUND' }
$root = (Resolve-Path -LiteralPath $PackageRoot).Path.TrimEnd('\')
if ($root -ieq $Target.TrimEnd('\') -or $root.StartsWith($Target.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'DO_NOT_EXTRACT_UPDATE_PACKAGE_INSIDE_C_UQP'
}

$required = @(
    'payload\server\dist\server.js',
    'payload\server\node_modules',
    'payload\server\package.json',
    'payload\client\dist\index.html',
    'sql\929_Existing_UQP_TestDB.sql',
    'SHA256SUMS.csv'
)
foreach ($path in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $path))) {
        throw "PACKAGE_REQUIRED_PATH_MISSING: $path"
    }
}
if (-not (Test-Path -LiteralPath (Join-Path $Target 'server\dist\server.js') -PathType Leaf)) { throw 'EXISTING_SERVER_NOT_FOUND' }
if (-not (Test-Path -LiteralPath (Join-Path $Target 'client\dist\index.html') -PathType Leaf)) { throw 'EXISTING_CLIENT_NOT_FOUND' }
if (-not (Test-Path -LiteralPath (Join-Path $Target 'server\node_modules') -PathType Container)) { throw 'EXISTING_SERVER_MODULES_NOT_FOUND' }
$originalEnv = Join-Path $Target 'server\.env'
if (-not (Test-Path -LiteralPath $originalEnv -PathType Leaf)) { throw 'EXISTING_ENV_NOT_FOUND' }

$dbSettings = @(Get-Content -LiteralPath $originalEnv |
    Where-Object { $_ -match '^\s*PLATFORM_DB_DATABASE\s*=' })
if ($dbSettings.Count -ne 1) { throw 'PLATFORM_DB_DATABASE_MISSING_OR_DUPLICATE' }
$dbName = ($dbSettings[0] -split '=',2)[1].Trim().Trim('"').Trim("'")
if ($dbName -cne 'UniversalQueryPlatform') {
    throw "DATABASE_NAME_MISMATCH: expected UniversalQueryPlatform, got $dbName"
}

# Verify every payload file against the build's SHA256 manifest before any changes.
$manifestPath = Join-Path $root 'SHA256SUMS.csv'
$entries = @(Import-Csv -LiteralPath $manifestPath)
if ($entries.Count -lt 100) { throw 'HASH_MANIFEST_INCOMPLETE' }
$allFiles = @(Get-ChildItem -LiteralPath $root -Recurse -File -Force |
    Where-Object { $_.FullName -ne $manifestPath })
if ($allFiles.Count -ne $entries.Count) {
    throw "PACKAGE_FILE_COUNT_MISMATCH: actual=$($allFiles.Count) manifest=$($entries.Count)"
}
$seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
foreach ($entry in $entries) {
    $rel = [string]$entry.Path
    if ([string]::IsNullOrWhiteSpace($rel) -or
        $rel.StartsWith('/') -or $rel.StartsWith('\') -or
        $rel -match '(^|[\/])\.\.([\/]|$)' -or
        $rel -match '^[A-Za-z]:') { throw 'UNSAFE_MANIFEST_PATH' }
    if (-not $seen.Add($rel)) { throw "DUPLICATE_MANIFEST_PATH: $rel" }
    $f = Join-Path $root ($rel -replace '/', '\')
    if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { throw "MANIFEST_FILE_MISSING: $rel" }
    $got = (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($got -ne ([string]$entry.SHA256).ToLowerInvariant()) { throw "FILE_SHA256_MISMATCH: $rel" }
}
if (@(Get-ChildItem -LiteralPath (Join-Path $root 'payload') -Recurse -File -Force |
    Where-Object { $_.Name -in @('.env','.env.production','web.config') }).Count -ne 0) {
    throw 'PAYLOAD_HAS_ENV_OR_WEB_CONFIG'
}
Write-Host "PR99_PR100_V2_HASHES_PASS:files=$($entries.Count)"

# Do not kill all node processes, as other systems use the same machine.
if (@(Get-NetTCPConnection -LocalPort 3200 -State Listen -ErrorAction SilentlyContinue).Count -gt 0) {
    throw 'PORT_3200_BUSY: stop only the existing UQP server via the original method'
}

# Backup binaries only; no .env, SQL credentials, port, DB, or runtime flags changed.
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$backup = "C:\UQP_Backup\PR99-PR100-before-$stamp"
$parts = @(
    @{ Relative='server\dist'; Saved='server_dist' },
    @{ Relative='server\node_modules'; Saved='server_node_modules' },
    @{ Relative='client\dist'; Saved='client_dist' }
)
New-Item -ItemType Directory -Force -Path $backup | Out-Null
$oldPackage = Join-Path $Target 'server\package.json'
$oldPackageBackup = Join-Path $backup 'server_package.json'
if (Test-Path -LiteralPath $oldPackage -PathType Leaf) {
    Copy-Item -LiteralPath $oldPackage -Destination $oldPackageBackup
}
$backed = New-Object 'System.Collections.Generic.List[string]'
try {
    foreach ($part in $parts) {
        $src = Join-Path $Target $part.Relative
        if (-not (Test-Path -LiteralPath $src -PathType Container)) { throw "TARGET_PATH_MISSING: $src" }
        Move-Item -LiteralPath $src -Destination (Join-Path $backup $part.Saved)
        [void]$backed.Add($part.Relative)
    }
    foreach ($part in $parts) {
        $src = Join-Path $root ("payload\" + $part.Relative)
        $dst = Join-Path $Target $part.Relative
        Copy-Item -LiteralPath $src -Destination $dst -Recurse
    }
    Copy-Item -LiteralPath (Join-Path $root 'payload\server\package.json') -Destination $oldPackage -Force
    $webConfig = Join-Path $backup 'client_dist\web.config'
    if (Test-Path -LiteralPath $webConfig -PathType Leaf) {
        Copy-Item -LiteralPath $webConfig -Destination (Join-Path $Target 'client\dist\web.config') -Force
        Write-Host 'PR99_PR100_WEB_CONFIG_PRESERVED'
    }
    foreach ($testPath in @('server\dist\server.js','client\dist\index.html','server\.env')) {
        if (-not (Test-Path -LiteralPath (Join-Path $Target $testPath) -PathType Leaf)) {
            throw "UPDATED_REQUIRED_FILE_MISSING: $testPath"
        }
    }
    Write-Host 'PR99_PR100_V2_UPDATE_PASS'
    Write-Host 'PR99_PR100_EXISTING_ENV_PRESERVED'
    Write-Host 'PR99_PR100_EXISTING_PORT_DB_PRESERVED'
    Write-Host "BACKUP_PATH:$backup"
    Write-Host 'NEXT: restart existing UQP using the original startup method'
} catch {
    Write-Warning "Update failed. Restoring original binaries: $($_.Exception.Message)"
    foreach ($part in $parts) {
        if ($backed.Contains($part.Relative)) {
            $dst = Join-Path $Target $part.Relative
            $saved = Join-Path $backup $part.Saved
            if (Test-Path -LiteralPath $dst) { Remove-Item -LiteralPath $dst -Recurse -Force }
            if (Test-Path -LiteralPath $saved) { Move-Item -LiteralPath $saved -Destination $dst }
        }
    }
    if (Test-Path -LiteralPath $oldPackageBackup) {
        Copy-Item -LiteralPath $oldPackageBackup -Destination $oldPackage -Force
    }
    throw
}
