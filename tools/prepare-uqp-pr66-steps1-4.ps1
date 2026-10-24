# UQP PR66 steps 1-4: offline package verification, app backup and approved 925 installation.
# Does not create SQL backups or stop services. Requires DBA-verified SQL backup + restore.
[CmdletBinding()]
param(
 [string]$Target='C:\UQP',
 [string]$BackupRoot='C:\UQP_Backup',
 [switch]$Apply925
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$release=[IO.Path]::GetFullPath($PSScriptRoot)
$installer=Join-Path $release 'install-uqp-pr66-offline.ps1'
$dbTool=Join-Path $release 'payload\tools\install-uqp-925.ps1'
$existingEnv=Join-Path $Target 'server\.env'
if(!(Test-Path -LiteralPath $Target -PathType Container)){throw 'UQP_EXISTING_TARGET_REQUIRED'}
if(!(Test-Path -LiteralPath $existingEnv -PathType Leaf)){throw 'UQP_EXISTING_SERVER_ENV_REQUIRED'}
if(!(Test-Path -LiteralPath $installer -PathType Leaf) -or !(Test-Path -LiteralPath $dbTool -PathType Leaf)){throw 'UQP_RELEASE_INCOMPLETE'}
Write-Host 'STEP1: verify download payload hashes; no files modified.'
& $installer -Target $Target -PreflightOnly
Write-Host 'STEP2: make offline copy of existing C:\UQP, including local settings.'
if(!(Test-Path -LiteralPath $BackupRoot -PathType Container)){New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null}
$stamp=Get-Date -Format 'yyyyMMdd_HHmmss'
$dest=Join-Path $BackupRoot ('UQP-before-PR66-'+$stamp)
if(Test-Path -LiteralPath $dest){throw 'UQP_BACKUP_COLLISION'}
Copy-Item -LiteralPath $Target -Destination $dest -Recurse -Force
if(!(Test-Path -LiteralPath (Join-Path $dest 'server\.env'))){throw 'UQP_BACKUP_VERIFICATION_FAILED'}
Write-Host ('APPLICATION_BACKUP_CREATED: '+$dest)
Write-Host 'STEP3: DBA must separately back up and restore-verify the actual SQL Server database.'
Write-Host 'No automatic SQL BACKUP or RESTORE is performed by this script.'
if((Read-Host 'DBA has confirmed verified SQL backup, restore drill, correct DB/instance and maintenance approval? Type VERIFIED') -cne 'VERIFIED'){throw 'UQP_DATABASE_BACKUP_UNVERIFIED'}
Write-Host 'STEP4: run dedicated 925 preflight against the explicitly confirmed target.'
& $dbTool -Mode Preflight -ExistingServerEnv $existingEnv
if(-not $Apply925){Write-Host 'PREFLIGHT_STAGE_COMPLETE: 925 Apply not requested. No database changes.';return}
if((Read-Host 'Approve 925 schema installation on the exact target after preflight? Type APPLY 925') -cne 'APPLY 925'){throw 'UQP_925_NOT_APPROVED'}
& $dbTool -Mode Apply -ExistingServerEnv $existingEnv
& $dbTool -Mode Verify -ExistingServerEnv $existingEnv
Write-Host 'STEP_1_TO_4_COMPLETE: review 925 Verify output before Step 5 deployment.'
