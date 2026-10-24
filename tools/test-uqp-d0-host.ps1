# UQP D0 local host inspection. Read-only, offline, PowerShell 5.1 compatible.
# Does not connect to databases, start services, inspect secrets, or change configuration.
[CmdletBinding()]
param([string]$UqpDirectory = 'C:\UQP')
$ErrorActionPreference='Stop'
$items=New-Object System.Collections.Generic.List[object]
function Add-Check([string]$Name,[string]$Status,[string]$Detail) {
  $items.Add([pscustomobject]@{ Check=$Name; Status=$Status; Detail=$Detail })
}
try {
  if (Test-Path -LiteralPath $UqpDirectory -PathType Container) {
    Add-Check 'UQP directory' 'PASS' 'Directory exists; no files modified'
  } else { Add-Check 'UQP directory' 'REVIEW' 'Directory is missing; select the actual installed folder' }
  $node=Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) { Add-Check 'Node.js' 'BLOCKED' 'node.exe not found in PATH' }
  else {
    $version=(& $node.Source --version 2>$null)
    if ($LASTEXITCODE -ne 0) { Add-Check 'Node.js' 'BLOCKED' 'Unable to read Node.js version' }
    elseif ($version -match '^v22\.') { Add-Check 'Node.js' 'PASS' $version }
    else { Add-Check 'Node.js' 'REVIEW' ('Expected Node.js 22, found '+$version) }
  }
  $npm=Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($npm) { Add-Check 'npm' 'PASS' 'npm.cmd found' }
  else { Add-Check 'npm' 'BLOCKED' 'npm.cmd not found' }
  $client=Join-Path $UqpDirectory 'client\package.json'
  $server=Join-Path $UqpDirectory 'server\package.json'
  foreach($entry in @(@('Server manifest',$server),@('Client manifest',$client))) {
    if(Test-Path -LiteralPath $entry[1] -PathType Leaf){Add-Check $entry[0] 'PASS' 'package.json found'}
    else{Add-Check $entry[0] 'REVIEW' 'package.json missing'}
  }
  $oracle=Get-ChildItem Env: -ErrorAction SilentlyContinue | Where-Object { $_.Name -in @('ORACLE_HOME','TNS_ADMIN') }
  Add-Check 'Oracle environment' 'REVIEW' ('Oracle environment variable names: '+ (($oracle | ForEach-Object { $_.Name }) -join ', ') + '; verify Thick Client path/bitness manually')
  Add-Check 'Oracle 11g connectivity' 'BLOCKED' 'Not tested: requires separate authorized read-only acceptance'
  Add-Check 'SQL Server 925' 'BLOCKED' 'Not tested: DBA must run dedicated approved Preflight on an isolated replica'
  Add-Check 'Production deployment' 'BLOCKED' 'Read-only D0 check cannot authorize migration or deployment'
} catch { Add-Check 'Inspector' 'BLOCKED' 'An inspection step failed; examine script and host permissions' }
$items | Format-Table -AutoSize
if(@($items | Where-Object {$_.Status -eq 'BLOCKED' -and $_.Check -in @('Node.js','npm')}).Count -gt 0){exit 2}
exit 0
