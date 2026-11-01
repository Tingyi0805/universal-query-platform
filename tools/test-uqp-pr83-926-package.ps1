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
& $verify -PackageRoot $PackageRoot
$test=Join-Path $env:RUNNER_TEMP ('uqp-926-package-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $test|Out-Null
try {
 Expand-Archive -LiteralPath $ZipPath -DestinationPath $test
 & $verify -PackageRoot $test
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
