# Parse without installing, creating a task or touching any production directory.
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Install-Agent.ps1'),[ref]$tokens,[ref]$errors) | Out-Null
if($errors.Count){throw 'INSTALLER_POWERSHELL_SYNTAX_FAILED'}
Write-Host 'MANAGED_INSTALLER_POWERSHELL_SYNTAX_PASS (no install/signing/reboot acceptance)'
