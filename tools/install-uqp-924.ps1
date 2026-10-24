# UQP Migration 924 - manually approved installation only.
# Windows PowerShell 5.1 compatible. Do not print SQL passwords.
param(
  [ValidateSet("Install", "Verify", "Preflight")]
  [string]$Mode = "Install"
)
$ErrorActionPreference = "Stop"
$serverDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\server"))
if (-not (Test-Path (Join-Path $serverDir "package.json"))) {
  throw "924_SERVER_PACKAGE_NOT_FOUND"
}
if (-not (Test-Path (Join-Path $serverDir "node_modules"))) {
  throw "924_DEPENDENCIES_NOT_INSTALLED_RUN_NPM_INSTALL_IN_SERVER_FIRST"
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw "924_NODE_AND_NPM_REQUIRED"
}

$previousDbUser = [Environment]::GetEnvironmentVariable("PLATFORM_DB_USER", "Process")
$previousDbPassword = [Environment]::GetEnvironmentVariable("PLATFORM_DB_PASSWORD", "Process")
$separateInstallerLogin = $false
$pushed = $false

try {
  $expectedServer = Read-Host "Confirm SQL @@SERVERNAME from SSMS (not IP/DNS)"
  $expectedDb = Read-Host "Confirm UQP database name"

  $useSeparateLogin = Read-Host "Use a separate SQL installer login for 924 only? (Y/N, default N)"
  if ($useSeparateLogin -match '^[Yy]$') {
    $installerUser = Read-Host "SQL installer login (effective dbo on target DB required)"
    if ([string]::IsNullOrWhiteSpace($installerUser)) {
      throw "924_INSTALLER_LOGIN_REQUIRED"
    }
    $securePassword = Read-Host "SQL installer password (hidden)" -AsSecureString
    if ($securePassword.Length -eq 0) {
      $securePassword.Dispose()
      throw "924_INSTALLER_PASSWORD_REQUIRED"
    }
    $passwordPointer = [IntPtr]::Zero
    try {
      $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
      $env:PLATFORM_DB_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
      $env:PLATFORM_DB_USER = $installerUser
      $separateInstallerLogin = $true
    } finally {
      if ($passwordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
      }
      $securePassword.Dispose()
    }
    $expectedLogin = $installerUser
    Write-Host "Installer login used only for this run. server/.env is unchanged."
  } else {
    throw "924_SEPARATE_INSTALLER_LOGIN_REQUIRED_NO_RUNTIME_ELEVATION"
  }

  if ([string]::IsNullOrWhiteSpace($expectedServer) -or
      [string]::IsNullOrWhiteSpace($expectedDb) -or
      [string]::IsNullOrWhiteSpace($expectedLogin)) {
    throw "924_TARGET_DETAILS_REQUIRED"
  }

  $env:UQP_924_EXPECTED_SERVER = $expectedServer
  $env:UQP_924_EXPECTED_DATABASE = $expectedDb
  $env:UQP_924_EXPECTED_LOGIN = $expectedLogin

  Push-Location $serverDir
  $pushed = $true

  Write-Host "924: PRE-FLIGHT (read-only) ..." -ForegroundColor Cyan
  & npm.cmd run db:924:preflight
  if ($LASTEXITCODE -ne 0) { throw "924_PREFLIGHT_STOP_NO_MUTATION" }
  if ($Mode -eq "Preflight") { return }

  if ($Mode -eq "Install") {
    Write-Host "924: Adds one Binding table, two permission definitions, Decision DENY and one ledger entry."
    Write-Host "924: No existing account, password, role membership or policy is changed; no Scope is granted."
    Write-Host "924: STOP if the target DB is shared with live UQP services."
    $backup = Read-Host "Have you verified a restorable backup/snapshot? Type YES"
    if ($backup -cne "YES") { throw "924_BACKUP_NOT_CONFIRMED" }
    $confirm = Read-Host "To approve installation, retype the exact database name"
    if ($confirm -cne $expectedDb) { throw "924_EXPLICIT_DATABASE_APPROVAL_FAILED" }
    $maintenance = Read-Host "Is this separately approved isolated target stopped for maintenance? Type YES"
    if ($maintenance -cne "YES") { throw "924_ISOLATED_MAINTENANCE_NOT_APPROVED" }
    $env:UQP_924_MAINTENANCE_APPROVED = "YES"
    $env:UQP_924_BACKUP_VERIFIED = "YES"
    $env:UQP_924_APPROVE_INSTALL = "I_APPROVE_ISOLATED_924"
    Write-Host "924: Applying ONLY Migration 924 ..." -ForegroundColor Cyan
    & npm.cmd run db:924:apply -- --confirm
    if ($LASTEXITCODE -ne 0) { throw "924_INSTALL_FAILED_NO_SUCCESS_CLAIM_CHECK_STATE" }
  }

  Write-Host "924: VERIFY (read-only) ..." -ForegroundColor Cyan
  & npm.cmd run db:924:verify
  if ($LASTEXITCODE -ne 0) { throw "924_POST_INSTALL_VERIFICATION_FAILED" }
  Write-Host "924: VERIFIED; runtime delivery and preview remain disabled." -ForegroundColor Green
} finally {
  if ($pushed) { Pop-Location }
  Remove-Item Env:UQP_924_EXPECTED_SERVER -ErrorAction SilentlyContinue
  Remove-Item Env:UQP_924_EXPECTED_DATABASE -ErrorAction SilentlyContinue
  Remove-Item Env:UQP_924_EXPECTED_LOGIN -ErrorAction SilentlyContinue
  Remove-Item Env:UQP_924_MAINTENANCE_APPROVED -ErrorAction SilentlyContinue
  Remove-Item Env:UQP_924_BACKUP_VERIFIED -ErrorAction SilentlyContinue
  Remove-Item Env:UQP_924_APPROVE_INSTALL -ErrorAction SilentlyContinue
  if ($separateInstallerLogin) {
    [Environment]::SetEnvironmentVariable("PLATFORM_DB_USER", $previousDbUser, "Process")
    [Environment]::SetEnvironmentVariable("PLATFORM_DB_PASSWORD", $previousDbPassword, "Process")
  }
}
