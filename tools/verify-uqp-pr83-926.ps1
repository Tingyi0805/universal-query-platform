# Read-only package verifier. No SQL, services, deployment writes, configuration reads or installer invocation.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$PackageRoot)
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath $PackageRoot).Path.TrimEnd('\','/')
$manifest=Get-Content -LiteralPath (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json
if($manifest.format -ne 'UQP_PR83_926_RELEASE_V1' -or $manifest.sourceCommit -notmatch '^[a-f0-9]{40}$' -or $manifest.pr66Comparison.behind -ne 0 -or $manifest.approvalStatus -ne 'BLOCKED_PENDING_MANUAL_ACCEPTANCE'){throw '926_RELEASE_MANIFEST_INVALID'}
if($manifest.migration926Sha256 -ne 'f2d17b2a24963860e646a620f9548b22ff6a1a296e077071e8fb50237c8cfd43'){throw '926_MIGRATION_HASH_INVALID'}
$seen=@{}
foreach($line in Get-Content -LiteralPath (Join-Path $root 'SHA256SUMS.txt')){
 if($line -notmatch '^([a-f0-9]{64})  (.+)$'){throw '926_CHECKSUM_FORMAT_INVALID'}
 $expected=$Matches[1];$rel=$Matches[2]
 if($rel -match '(^/|\\|:|(^|/)\.{1,2}(/|$)|[\r\n])' -or $seen.ContainsKey($rel)){throw '926_PATH_INVALID_OR_DUPLICATE'}
 $seen[$rel]=$expected
 $file=Join-Path $root $rel
 if(-not (Test-Path -LiteralPath $file -PathType Leaf)){throw "926_FILE_MISSING: $rel"}
 if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected){throw "926_FILE_HASH_MISMATCH: $rel"}
}
$actual=@(Get-ChildItem -LiteralPath $root -Recurse -Force)
foreach($entry in $actual){
 if(($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw '926_REPARSE_POINT_FORBIDDEN'}
 if(-not $entry.PSIsContainer){$rel=$entry.FullName.Substring($root.Length+1).Replace('\','/');if($rel -ne 'SHA256SUMS.txt' -and -not $seen.ContainsKey($rel)){throw "926_UNMANIFESTED_FILE: $rel"}}
}
if(-not $seen.ContainsKey('manifest.json') -or $seen.Count -ne @($manifest.files).Count+1){throw '926_MANIFEST_FILE_COUNT_MISMATCH'}
foreach($f in $manifest.files){if(-not $seen.ContainsKey($f.path) -or $seen[$f.path] -ne $f.sha256 -or (Get-Item -LiteralPath (Join-Path $root $f.path)).Length -ne $f.bytes){throw '926_MANIFEST_ENTRY_MISMATCH'}}
foreach($critical in @('payload/server/dist/server.js','payload/server/dist/scripts/reconcileDeviceLifecycle926.js','payload/server/dist/scripts/deviceLifecycle926Reconciliation.js','payload/server/dist/modules/dashboard/dashboardDevice.repository.js','payload/client/dist/index.html','payload/database/migrations/926_dashboard_device_lifecycle.sql','verify-uqp-pr83-926.ps1')){if(-not $seen.ContainsKey($critical)){throw "926_REQUIRED_FILE_MISSING: $critical"}}
foreach($job in @('server','client','device-lifecycle-d1-sql','windows-node24-dependencies','windows-kiosk-launcher','dependency-sql-smoke')){if($manifest.ci.jobs.$job.result -ne 'success'){throw '926_CI_EVIDENCE_INCOMPLETE'}}
$identity=node -p 'JSON.stringify({node:process.version,abi:process.versions.modules,platform:process.platform,arch:process.arch})'
if($LASTEXITCODE -ne 0){throw '926_NODE_NOT_AVAILABLE'}
$runtime=$identity | ConvertFrom-Json
foreach($field in @('node','abi','platform','arch')){if($runtime.$field -ne $manifest.runtime.$field){throw "926_NODE_RUNTIME_MISMATCH: $field"}}
Write-Host "926_PACKAGE_HASHES_PASS: $($manifest.sourceCommit); files=$($manifest.files.Count)"
Write-Host 'BLOCKED_PENDING_MANUAL_ACCEPTANCE: verification does not authorize production overwrite or ledger adoption.'
