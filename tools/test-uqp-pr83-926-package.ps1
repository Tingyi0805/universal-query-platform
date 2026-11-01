# CI synthetic package tests only. Never targets an installed application.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$PackageRoot,[Parameter(Mandatory=$true)][string]$ZipPath)
$ErrorActionPreference='Stop'
$verify=(Resolve-Path '.\tools\verify-uqp-pr83-926.ps1').Path
foreach($file in @($verify,$PSCommandPath)){
 $tokens=$null;$errors=$null
 [System.Management.Automation.Language.Parser]::ParseFile($file,[ref]$tokens,[ref]$errors)|Out-Null
 if($errors.Count){throw '926_POWERSHELL_51_SYNTAX_INVALID'}
}
# Reject each mismatched field before the expensive full package hash pass.
$manifest=Get-Content -LiteralPath (Join-Path $PackageRoot 'manifest.json') -Raw | ConvertFrom-Json
if($manifest.runtime.node -ne 'v24.22.1' -or $manifest.runtime.abi -ne '137' -or $manifest.runtime.platform -ne 'win32' -or $manifest.runtime.arch -ne 'x64'){throw 'D7_RELEASE_RUNTIME_TARGET_INVALID'}
$fixture=Join-Path $env:RUNNER_TEMP ('uqp-926-runtime-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture|Out-Null
$fixtureManifest=@{format=$manifest.format;sourceCommit=$manifest.sourceCommit;pr66Comparison=@{behind=0};approvalStatus=$manifest.approvalStatus;migration926Sha256=$manifest.migration926Sha256;runtime=$manifest.runtime}
try {
 foreach($field in @('node','abi','platform','arch')){
  $original=$manifest.runtime.$field
  $wrong=@{node='v24.15.0';abi='136';platform='linux';arch='arm64'}
  $manifest.runtime.$field=$wrong[$field]
  $fixtureManifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $fixture 'manifest.json') -Encoding UTF8
  $message=$null;try{& $verify -PackageRoot $fixture}catch{$message=$_.Exception.Message}
  if($message -ne "926_NODE_RUNTIME_MISMATCH: $field"){throw "D7_RUNTIME_MISMATCH_NOT_REJECTED: $field"}
  $manifest.runtime.$field=$original
 }
 Write-Host 'D7_RUNTIME_REJECTION_PASS: node; ABI; platform; arch (old Node 24.15.0 rejected)'
} finally {Remove-Item -LiteralPath $fixture -Recurse -Force}
& $verify -PackageRoot $PackageRoot
$test=Join-Path $env:RUNNER_TEMP ('uqp-926-package-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $test|Out-Null
try {
 Expand-Archive -LiteralPath $ZipPath -DestinationPath $test
 & $verify -PackageRoot $test
 node .\tools\test-pr83-node-runtime.mjs (Join-Path $test 'payload/server')
 if($LASTEXITCODE -ne 0){throw 'D7_EXTRACTED_NATIVE_RUNTIME_FAILED'}
 $file=Join-Path $test 'payload/client/dist/index.html'
 $bytes=[IO.File]::ReadAllBytes($file)
 [IO.File]::AppendAllText($file,'tampered')
 $denied=$false;try{& $verify -PackageRoot $test}catch{$denied=$true}
 if(-not $denied){throw '926_TAMPER_NOT_REJECTED'}
 [IO.File]::WriteAllBytes($file,$bytes)
 $extra=Join-Path $test 'unexpected.txt';[IO.File]::WriteAllText($extra,'synthetic')
 $denied=$false;try{& $verify -PackageRoot $test}catch{$denied=$true}
 if(-not $denied){throw '926_EXTRA_FILE_NOT_REJECTED'}
 Remove-Item -LiteralPath $extra
 $sums=Join-Path $test 'SHA256SUMS.txt';$original=[IO.File]::ReadAllBytes($sums)
 [IO.File]::AppendAllText($sums,('0'*64)+'  ../outside.txt'+[Environment]::NewLine)
 $denied=$false;try{& $verify -PackageRoot $test}catch{$denied=$true}
 if(-not $denied){throw '926_PATH_TRAVERSAL_NOT_REJECTED'}
 [IO.File]::WriteAllBytes($sums,$original)
 & $verify -PackageRoot $test
 Write-Host 'D6_PACKAGE_TESTS_PASS: valid; ZIP-roundtrip; tamper; unexpected-file; traversal; repaired-package'
} finally {Remove-Item -LiteralPath $test -Recurse -Force}
