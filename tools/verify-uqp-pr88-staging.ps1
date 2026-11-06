# Read-only PR88 Windows TEST package verifier. No SQL, services, deployment writes, configuration reads or installer.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$PackageRoot)
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath $PackageRoot).Path.TrimEnd('\','/')
$manifest=Get-Content -LiteralPath (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json
if($manifest.format -ne 'UQP_PR88_WINDOWS_TEST_STAGING_V1' -or $manifest.sourceCommit -notmatch '^[a-f0-9]{40}
if($manifest.migration926Sha256 -ne 'f2d17b2a24963860e646a620f9548b22ff6a1a296e077071e8fb50237c8cfd43'){throw 'PR88_MIGRATION_HASH_INVALID'}
$identity=node -p 'JSON.stringify({node:process.version,abi:process.versions.modules,platform:process.platform,arch:process.arch})'
if($LASTEXITCODE -ne 0){throw 'PR88_NODE_NOT_AVAILABLE'}
$runtime=$identity | ConvertFrom-Json
foreach($field in @('node','abi','platform','arch')){if($runtime.$field -ne $manifest.runtime.$field){throw "926_NODE_RUNTIME_MISMATCH: $field"}}
foreach($change in @($manifest.changedFiles)){if($change -notmatch '^(client/|docs/|\.github/workflows/ci\.yml$|tools/(?:package-pr88-staging\.mjs|verify-uqp-pr88-staging\.ps1|test-uqp-pr88-staging\.ps1)$)'){throw 'PR88_UNEXPECTED_SOURCE_CHANGE'}}
$seen=@{}
foreach($line in Get-Content -LiteralPath (Join-Path $root 'SHA256SUMS.txt')){
 if($line -notmatch '^([a-f0-9]{64})  (.+)$'){throw 'PR88_CHECKSUM_FORMAT_INVALID'}
 $expected=$Matches[1];$rel=$Matches[2]
 if($rel -match '(^/|\\|:|(^|/)\.{1,2}(/|$)|[\r\n])' -or $seen.ContainsKey($rel)){throw 'PR88_PATH_INVALID_OR_DUPLICATE'}
 $seen[$rel]=$expected
 $file=Join-Path $root $rel
 if(-not (Test-Path -LiteralPath $file -PathType Leaf)){throw "926_FILE_MISSING: $rel"}
 if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected){throw "926_FILE_HASH_MISMATCH: $rel"}
}
$actual=@(Get-ChildItem -LiteralPath $root -Recurse -Force)
foreach($entry in $actual){
 if(($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'PR88_REPARSE_POINT_FORBIDDEN'}
 if(-not $entry.PSIsContainer){$rel=$entry.FullName.Substring($root.Length+1).Replace('\','/');if($rel -ne 'SHA256SUMS.txt' -and -not $seen.ContainsKey($rel)){throw "926_UNMANIFESTED_FILE: $rel"}}
}
if(-not $seen.ContainsKey('manifest.json') -or $seen.Count -ne @($manifest.files).Count+1){throw 'PR88_MANIFEST_FILE_COUNT_MISMATCH'}
foreach($f in $manifest.files){if(-not $seen.ContainsKey($f.path) -or $seen[$f.path] -ne $f.sha256 -or (Get-Item -LiteralPath (Join-Path $root $f.path)).Length -ne $f.bytes){throw 'PR88_MANIFEST_ENTRY_MISMATCH'}}
foreach($critical in @('payload/server/dist/server.js','payload/server/dist/scripts/reconcileDeviceLifecycle926.js','payload/server/dist/scripts/deviceLifecycle926Reconciliation.js','payload/server/dist/modules/dashboard/dashboardDevice.repository.js','payload/client/dist/index.html','payload/client/PR88-TEST-README.txt','payload/database/migrations/926_dashboard_device_lifecycle.sql','verify-uqp-pr88-staging.ps1')){if(-not $seen.ContainsKey($critical)){throw "926_REQUIRED_FILE_MISSING: $critical"}}
foreach($job in @('server','client','device-lifecycle-d1-sql','windows-node24-dependencies','windows-kiosk-launcher','dependency-sql-smoke')){if($manifest.ci.jobs.$job.result -ne 'success'){throw 'PR88_CI_EVIDENCE_INCOMPLETE'}}
Write-Host "PR88_WINDOWS_TEST_HASHES_PASS: $($manifest.sourceCommit); files=$($manifest.files.Count)"
Write-Host 'TEST_ONLY_NO_DEPLOYMENT_AUTHORIZATION: no production overwrite, migration, or ledger adoption.'
 -or $manifest.sourceTree -notmatch '^[a-f0-9]{40}
if($manifest.migration926Sha256 -ne 'f2d17b2a24963860e646a620f9548b22ff6a1a296e077071e8fb50237c8cfd43'){throw 'PR88_MIGRATION_HASH_INVALID'}
$identity=node -p 'JSON.stringify({node:process.version,abi:process.versions.modules,platform:process.platform,arch:process.arch})'
if($LASTEXITCODE -ne 0){throw 'PR88_NODE_NOT_AVAILABLE'}
$runtime=$identity | ConvertFrom-Json
foreach($field in @('node','abi','platform','arch')){if($runtime.$field -ne $manifest.runtime.$field){throw "926_NODE_RUNTIME_MISMATCH: $field"}}
$seen=@{}
foreach($line in Get-Content -LiteralPath (Join-Path $root 'SHA256SUMS.txt')){
 if($line -notmatch '^([a-f0-9]{64})  (.+)$'){throw 'PR88_CHECKSUM_FORMAT_INVALID'}
 $expected=$Matches[1];$rel=$Matches[2]
 if($rel -match '(^/|\\|:|(^|/)\.{1,2}(/|$)|[\r\n])' -or $seen.ContainsKey($rel)){throw 'PR88_PATH_INVALID_OR_DUPLICATE'}
 $seen[$rel]=$expected
 $file=Join-Path $root $rel
 if(-not (Test-Path -LiteralPath $file -PathType Leaf)){throw "926_FILE_MISSING: $rel"}
 if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected){throw "926_FILE_HASH_MISMATCH: $rel"}
}
$actual=@(Get-ChildItem -LiteralPath $root -Recurse -Force)
foreach($entry in $actual){
 if(($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'PR88_REPARSE_POINT_FORBIDDEN'}
 if(-not $entry.PSIsContainer){$rel=$entry.FullName.Substring($root.Length+1).Replace('\','/');if($rel -ne 'SHA256SUMS.txt' -and -not $seen.ContainsKey($rel)){throw "926_UNMANIFESTED_FILE: $rel"}}
}
if(-not $seen.ContainsKey('manifest.json') -or $seen.Count -ne @($manifest.files).Count+1){throw 'PR88_MANIFEST_FILE_COUNT_MISMATCH'}
foreach($f in $manifest.files){if(-not $seen.ContainsKey($f.path) -or $seen[$f.path] -ne $f.sha256 -or (Get-Item -LiteralPath (Join-Path $root $f.path)).Length -ne $f.bytes){throw 'PR88_MANIFEST_ENTRY_MISMATCH'}}
foreach($critical in @('payload/server/dist/server.js','payload/server/dist/scripts/reconcileDeviceLifecycle926.js','payload/server/dist/scripts/deviceLifecycle926Reconciliation.js','payload/server/dist/modules/dashboard/dashboardDevice.repository.js','payload/client/dist/index.html','payload/database/migrations/926_dashboard_device_lifecycle.sql','verify-uqp-pr83-926.ps1')){if(-not $seen.ContainsKey($critical)){throw "926_REQUIRED_FILE_MISSING: $critical"}}
foreach($job in @('server','client','device-lifecycle-d1-sql','windows-node24-dependencies','windows-kiosk-launcher','dependency-sql-smoke')){if($manifest.ci.jobs.$job.result -ne 'success'){throw 'PR88_CI_EVIDENCE_INCOMPLETE'}}
Write-Host "926_PACKAGE_HASHES_PASS: $($manifest.sourceCommit); files=$($manifest.files.Count)"
Write-Host 'BLOCKED_PENDING_MANUAL_ACCEPTANCE: verification does not authorize production overwrite or ledger adoption.'
 -or $manifest.pr83Baseline -ne '846483f6b1151eb12468d60369745fe77f0249b7' -or $manifest.pr83Comparison.behind -ne 0 -or $manifest.approvalStatus -ne 'TEST_ONLY_NO_DEPLOYMENT_AUTHORIZATION' -or $manifest.liveChartEnabled -ne $false -or $manifest.databaseActionsOnExtract -ne 'NONE'){throw 'PR88_STAGING_MANIFEST_INVALID'}
if($manifest.migration926Sha256 -ne 'f2d17b2a24963860e646a620f9548b22ff6a1a296e077071e8fb50237c8cfd43'){throw 'PR88_MIGRATION_HASH_INVALID'}
$identity=node -p 'JSON.stringify({node:process.version,abi:process.versions.modules,platform:process.platform,arch:process.arch})'
if($LASTEXITCODE -ne 0){throw 'PR88_NODE_NOT_AVAILABLE'}
$runtime=$identity | ConvertFrom-Json
foreach($field in @('node','abi','platform','arch')){if($runtime.$field -ne $manifest.runtime.$field){throw "926_NODE_RUNTIME_MISMATCH: $field"}}
$seen=@{}
foreach($line in Get-Content -LiteralPath (Join-Path $root 'SHA256SUMS.txt')){
 if($line -notmatch '^([a-f0-9]{64})  (.+)$'){throw 'PR88_CHECKSUM_FORMAT_INVALID'}
 $expected=$Matches[1];$rel=$Matches[2]
 if($rel -match '(^/|\\|:|(^|/)\.{1,2}(/|$)|[\r\n])' -or $seen.ContainsKey($rel)){throw 'PR88_PATH_INVALID_OR_DUPLICATE'}
 $seen[$rel]=$expected
 $file=Join-Path $root $rel
 if(-not (Test-Path -LiteralPath $file -PathType Leaf)){throw "926_FILE_MISSING: $rel"}
 if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected){throw "926_FILE_HASH_MISMATCH: $rel"}
}
$actual=@(Get-ChildItem -LiteralPath $root -Recurse -Force)
foreach($entry in $actual){
 if(($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'PR88_REPARSE_POINT_FORBIDDEN'}
 if(-not $entry.PSIsContainer){$rel=$entry.FullName.Substring($root.Length+1).Replace('\','/');if($rel -ne 'SHA256SUMS.txt' -and -not $seen.ContainsKey($rel)){throw "926_UNMANIFESTED_FILE: $rel"}}
}
if(-not $seen.ContainsKey('manifest.json') -or $seen.Count -ne @($manifest.files).Count+1){throw 'PR88_MANIFEST_FILE_COUNT_MISMATCH'}
foreach($f in $manifest.files){if(-not $seen.ContainsKey($f.path) -or $seen[$f.path] -ne $f.sha256 -or (Get-Item -LiteralPath (Join-Path $root $f.path)).Length -ne $f.bytes){throw 'PR88_MANIFEST_ENTRY_MISMATCH'}}
foreach($critical in @('payload/server/dist/server.js','payload/server/dist/scripts/reconcileDeviceLifecycle926.js','payload/server/dist/scripts/deviceLifecycle926Reconciliation.js','payload/server/dist/modules/dashboard/dashboardDevice.repository.js','payload/client/dist/index.html','payload/database/migrations/926_dashboard_device_lifecycle.sql','verify-uqp-pr83-926.ps1')){if(-not $seen.ContainsKey($critical)){throw "926_REQUIRED_FILE_MISSING: $critical"}}
foreach($job in @('server','client','device-lifecycle-d1-sql','windows-node24-dependencies','windows-kiosk-launcher','dependency-sql-smoke')){if($manifest.ci.jobs.$job.result -ne 'success'){throw 'PR88_CI_EVIDENCE_INCOMPLETE'}}
Write-Host "926_PACKAGE_HASHES_PASS: $($manifest.sourceCommit); files=$($manifest.files.Count)"
Write-Host 'BLOCKED_PENDING_MANUAL_ACCEPTANCE: verification does not authorize production overwrite or ledger adoption.'
