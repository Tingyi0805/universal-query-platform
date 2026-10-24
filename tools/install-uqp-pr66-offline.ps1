# UQP PR66 offline Windows installer. No database operations, no service manipulation.
# Only run after approved schema 925 and runtime permissions have been independently verified.
[CmdletBinding()]
param(
  [string]$Target='C:\UQP',
  [switch]$PreflightOnly,
  [switch]$Schema925Verified,
  [switch]$ServiceStopped,
  [switch]$AcceptMaintenance,
  [switch]$SimulateFailure
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=[IO.Path]::GetFullPath($PSScriptRoot)
$source=Join-Path $root 'payload'
$manifest=Join-Path $root 'SHA256SUMS.txt'
$targetPath=[IO.Path]::GetFullPath($Target).TrimEnd('\')
$parent=Split-Path -Parent $targetPath
$leaf=Split-Path -Leaf $targetPath
if($leaf -ne 'UQP' -and $leaf -notmatch '^UQP_[A-Za-z0-9_-]+$'){throw 'UQP_TARGET_NAME_NOT_APPROVED'}
if(-not (Test-Path -LiteralPath $source -PathType Container)){throw 'UQP_PAYLOAD_MISSING'}
if(-not (Test-Path -LiteralPath $manifest -PathType Leaf)){throw 'UQP_CHECKSUM_MANIFEST_MISSING'}
if(-not (Test-Path -LiteralPath $parent -PathType Container)){throw 'UQP_PARENT_NOT_FOUND'}
$packages=@('server','client')
foreach($name in $packages){
 if(-not (Test-Path -LiteralPath (Join-Path $source "$name\package.json"))){throw 'UQP_PACKAGE_INCOMPLETE'}
}
if(-not (Test-Path -LiteralPath (Join-Path $source 'server\dist\server.js'))){throw 'UQP_SERVER_BUILD_MISSING'}
if(-not (Test-Path -LiteralPath (Join-Path $source 'client\dist\index.html'))){throw 'UQP_CLIENT_BUILD_MISSING'}
# Independently validate every shipped file hash before any filesystem changes.
$expected=@{}
foreach($line in Get-Content -LiteralPath $manifest) {
 if($line -notmatch '^([0-9a-fA-F]{64})  (payload/.+)$'){throw 'UQP_MANIFEST_INVALID'}
 $relative=$Matches[2].Replace('/','\')
 if($relative -match '(^|\\)\.\.' -or $relative -match '[:<>|?*]' -or $expected.ContainsKey($relative)){throw 'UQP_MANIFEST_INVALID'}
 $expected[$relative]=$Matches[1].ToUpperInvariant()
}
$present=@(Get-ChildItem -LiteralPath $source -File -Recurse)
if($expected.Count -ne $present.Count){throw 'UQP_MANIFEST_FILE_COUNT_MISMATCH'}
foreach($file in $present){
 $rel=$file.FullName.Substring($root.Length+1)
 if(-not $expected.ContainsKey($rel)){throw 'UQP_MANIFEST_UNEXPECTED_FILE'}
 if((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -ne $expected[$rel]){throw 'UQP_CHECKSUM_MISMATCH'}
}
Write-Host "UQP_INSTALL_PREFLIGHT_OK: $targetPath"
if($PreflightOnly){return}
if(-not ($Schema925Verified -and $ServiceStopped -and $AcceptMaintenance)){throw 'UQP_APPROVALS_REQUIRED'}
if(-not (Test-Path -LiteralPath $targetPath -PathType Container)){throw 'UQP_EXISTING_TARGET_REQUIRED'}
if(Test-Path -LiteralPath (Join-Path $targetPath 'node_modules')){Write-Host 'Existing root node_modules are not copied into new release.'}
$stamp=Get-Date -Format 'yyyyMMdd_HHmmss'
$stage=Join-Path $parent "$leaf.staging.$stamp"
$backup=Join-Path $parent "$leaf.backup.$stamp"
if((Test-Path -LiteralPath $stage) -or (Test-Path -LiteralPath $backup)){throw 'UQP_STAGING_COLLISION'}
$swapped=$false
try {
 New-Item -ItemType Directory -Path $stage | Out-Null
 foreach($item in @('server','client','tools','docs','database')){
   $src=Join-Path $source $item
   if(Test-Path -LiteralPath $src){Copy-Item -LiteralPath $src -Destination (Join-Path $stage $item) -Recurse -Force}
 }
 # Never import bundled .env or secrets. Copy current local settings only.
 foreach($relative in @('server\.env','client\.env')){
   $original=Join-Path $targetPath $relative
   if(Test-Path -LiteralPath $original -PathType Leaf){
     $dest=Join-Path $stage $relative
     $destDir=Split-Path -Parent $dest
     if(-not (Test-Path -LiteralPath $destDir)){New-Item -ItemType Directory -Path $destDir -Force | Out-Null}
     Copy-Item -LiteralPath $original -Destination $dest -Force
   }
 }
 if($SimulateFailure){throw 'UQP_TEST_INJECTED_FAILURE'}
 Move-Item -LiteralPath $targetPath -Destination $backup
 $swapped=$true
 Move-Item -LiteralPath $stage -Destination $targetPath
 Write-Host "UQP_APPLICATION_SWITCHED backup=$backup"
 Write-Host 'UQP_MANUAL_SMOKE_TEST_REQUIRED: check health, login, Query, audit and public playback policy before resuming services.'
} catch {
 if($swapped){
   if(Test-Path -LiteralPath $targetPath){Move-Item -LiteralPath $targetPath -Destination "$stage.failed"}
   if(Test-Path -LiteralPath $backup){Move-Item -LiteralPath $backup -Destination $targetPath}
 }
 throw
}
