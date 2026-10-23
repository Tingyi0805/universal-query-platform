# UQP Migration 923 - operator-confirmed manual installation only.
# PS 5.1 compatible ASCII strings. Does not read/print DB passwords.
param(
  [ValidateSet("Install", "Verify", "Preflight")]
  [string]$Mode = "Install"
)
$ErrorActionPreference = "Stop"
$serverDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\server"))
if (-not (Test-Path (Join-Path $serverDir "package.json"))) {
  throw "923_SERVER_PACKAGE_NOT_FOUND"
}
if (-not (Test-Path (Join-Path $serverDir "node_modules"))) {
  throw "923_DEPENDENCIES_NOT_INSTALLED_RUN_NPM_INSTALL_IN_SERVER_FIRST"
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw "923_NODE_AND_NPM_REQUIRED"
}

$expectedServer = Read-Host "Confirm SQL @@SERVERNAME from SSMS (not IP/DNS)"
$expectedDb = Read-Host "Confirm UQP database name"
$expectedLogin = Read-Host "Confirm ORIGINAL_LOGIN() for installer"
if ([string]::IsNullOrWhiteSpace($expectedServer) -or
    [string]::IsNullOrWhiteSpace($expectedDb) -or
    [string]::IsNullOrWhiteSpace($expectedLogin)) {
  throw "923_TARGET_DETAILS_REQUIRED"
}

$env:UQP_923_EXPECTED_SERVER = $expectedServer
$env:UQP_923_EXPECTED_DATABASE = $expectedDb
$env:UQP_923_EXPECTED_LOGIN = $expectedLogin

try {
  Push-Location $serverDir
  try {
    Write-Host "923: PRE-FLIGHT (read-only) ..." -ForegroundColor Cyan
    & npm.cmd run db:923:preflight
    if ($LASTEXITCODE -ne 0) { throw "923_PREFLIGHT_STOP_NO_MUTATION" }
    if ($Mode -eq "Preflight") { return }

    if ($Mode -eq "Install") {
      Write-Host "923: This operation adds four uqp tables + one sequence and one schema ledger entry."
      Write-Host "923: No patients, Dataset values, roles or policies are intentionally changed."
      Write-Host "923: STOP if this database is shared with active UQP services."
      $backup = Read-Host "Have you verified a restorable backup/snapshot? Type YES"
      if ($backup -cne "YES") { throw "923_BACKUP_NOT_CONFIRMED" }
      $confirm = Read-Host "To approve installation, retype the exact database name"
      if ($confirm -cne $expectedDb) { throw "923_EXPLICIT_DATABASE_APPROVAL_FAILED" }
      $env:UQP_923_BACKUP_VERIFIED = "YES"
      $env:UQP_923_APPROVE_INSTALL = "I_APPROVE_REBUILT_UQP_923"
      Write-Host "923: Applying ONLY Migration 923 ..." -ForegroundColor Cyan
      & npm.cmd run db:923:apply -- --confirm
      if ($LASTEXITCODE -ne 0) { throw "923_INSTALL_FAILED_NO_SUCCESS_CLAIM_CHECK_STATE" }
    }
    Write-Host "923: VERIFY (read-only) ..." -ForegroundColor Cyan
    & npm.cmd run db:923:verify
    if ($LASTEXITCODE -ne 0) { throw "923_POST_INSTALL_VERIFICATION_FAILED" }
    Write-Host "923: VERIFIED, no runtime feature activated." -ForegroundColor Green
  } finally {
    Pop-Location
  }
} finally {
  Remove-Item Env:UQP_923_EXPECTED_SERVER -ErrorAction SilentlyContinue
  Remove-Item Env:UQP_923_EXPECTED_DATABASE -ErrorAction SilentlyContinue
  Remove-Item Env:UQP_923_EXPECTED_LOGIN -ErrorAction SilentlyContinue
  Remove-Item Env:UQP_923_BACKUP_VERIFIED -ErrorAction SilentlyContinue
  Remove-Item Env:UQP_923_APPROVE_INSTALL -ErrorAction SilentlyContinue
}
