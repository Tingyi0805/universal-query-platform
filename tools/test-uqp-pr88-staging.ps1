# Synthetic-only PR88 packaging acceptance. No deployment or SQL connections.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$PackageRoot,[Parameter(Mandatory=$true)][string]$ZipPath)
$ErrorActionPreference='Stop'
$verify=(Resolve-Path '.\tools\verify-uqp-pr88-staging.ps1').Path
foreach($file in @($verify,$PSCommandPath)){
 $tokens=$null;$errors=$null
 [System.Management.Automation.Language.Parser]::ParseFile($file,[ref]$tokens,[ref]$errors)|Out-Null
 if($errors.Count){throw 'PR88_POWERSHELL_51_SYNTAX_INVALID'}
}
& $verify -PackageRoot $PackageRoot
$test=Join-Path $env:RUNNER_TEMP ('uqp-pr88-staging-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $test|Out-Null
try {
 Expand-Archive -LiteralPath $ZipPath -DestinationPath $test
 & $verify -PackageRoot $test
 node .\tools\test-pr83-node-runtime.mjs (Join-Path $test 'payload/server')
 if($LASTEXITCODE -ne 0){throw 'PR88_EXTRACTED_NATIVE_RUNTIME_FAILED'}
 $file=Join-Path $test 'payload/client/dist/index.html'
 $original=[IO.File]::ReadAllBytes($file)
 [IO.File]::AppendAllText($file,'tampered')
 $blocked=$false;try{& $verify -PackageRoot $test}catch{$blocked=$true}
 if(-not $blocked){throw 'PR88_TAMPER_NOT_REJECTED'}
 [IO.File]::WriteAllBytes($file,$original)
 $extra=Join-Path $test 'unexpected.txt'
 [IO.File]::WriteAllText($extra,'synthetic')
 $blocked=$false;try{& $verify -PackageRoot $test}catch{$blocked=$true}
 if(-not $blocked){throw 'PR88_EXTRA_FILE_NOT_REJECTED'}
 Remove-Item -LiteralPath $extra
 $sums=Join-Path $test 'SHA256SUMS.txt'
 $saved=[IO.File]::ReadAllBytes($sums)
 [IO.File]::AppendAllText($sums,('0'*64)+'  ../outside.txt'+[Environment]::NewLine)
 $blocked=$false;try{& $verify -PackageRoot $test}catch{$blocked=$true}
 if(-not $blocked){throw 'PR88_TRAVERSAL_NOT_REJECTED'}
 [IO.File]::WriteAllBytes($sums,$saved)
 & $verify -PackageRoot $test
 Write-Host 'PR88_STAGING_PACKAGE_TESTS_PASS: valid; ZIP; native Windows runtime; tamper; unexpected; traversal; repaired'
} finally {
 Remove-Item -LiteralPath $test -Recurse -Force
}
