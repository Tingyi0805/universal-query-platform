# Offline feasibility test ONLY. Not a credential vault, enrollment tool or agent.
# Never accepts a Device Token; random test bytes are never written in plaintext.
param([string]$FixturePath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
$sha = [Security.Cryptography.SHA256]::Create()
try {
  if ($FixturePath) {
    $fixture = Get-Content -LiteralPath $FixturePath -Raw | ConvertFrom-Json
    $plain = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($fixture.blob), [Convert]::FromBase64String($fixture.context), $scope)
    try {
      if ([Convert]::ToBase64String($sha.ComputeHash($plain)) -cne $fixture.digest) { throw 'DPAPI_RESTORE_MISMATCH' }
    } finally { [Array]::Clear($plain, 0, $plain.Length) }
    exit 0
  }
  $plain = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($plain) } finally { $rng.Dispose() }
  $context = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes('uqp77-offline-test|http://synthetic.invalid|dashboard=1|device=7'))
  $cipher = [Security.Cryptography.ProtectedData]::Protect($plain, $context, $scope)
  $directory = Join-Path $env:TEMP ('uqp77-dpapi-test-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $directory | Out-Null
  try {
    $path = Join-Path $directory 'synthetic-protected-fixture.json'
    @{ blob = [Convert]::ToBase64String($cipher); context = [Convert]::ToBase64String($context); digest = [Convert]::ToBase64String($sha.ComputeHash($plain)) } | ConvertTo-Json | Set-Content -LiteralPath $path -Encoding UTF8
    & "$PSHOME\powershell.exe" -NoLogo -NoProfile -File $PSCommandPath -FixturePath $path
    if ($LASTEXITCODE -ne 0) { throw 'DPAPI_PROCESS_RESTART_FAILED' }
    foreach ($test in @('wrong-origin-device-context', 'tampered-blob')) {
      $bytes = [byte[]]$cipher.Clone(); $entropy = [byte[]]$context.Clone()
      if ($test -eq 'tampered-blob') { $bytes[$bytes.Length - 1] = $bytes[$bytes.Length - 1] -bxor 1 }
      else { $entropy[0] = $entropy[0] -bxor 1 }
      $rejected = $false
      try { $unexpected = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, $scope); [Array]::Clear($unexpected, 0, $unexpected.Length) } catch { $rejected = $true }
      if (-not $rejected) { throw 'DPAPI_INVALID_CONTEXT_ACCEPTED' }
    }
  } finally { [Array]::Clear($plain, 0, $plain.Length); Remove-Item -LiteralPath $directory -Recurse -Force }
  Write-Host 'DPAPI_CURRENT_USER_PROCESS_RESTART_CONTEXT_TAMPER_PASS (synthetic bytes only; no agent, network or reboot acceptance)'
} finally { $sha.Dispose() }
