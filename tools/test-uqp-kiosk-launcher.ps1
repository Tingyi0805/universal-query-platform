# Offline Windows parser/argument verification only; does not start a browser or touch UQP.
$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '../server')
try {
  $output = Join-Path $env:TEMP ('uqp-kiosk-test-' + [guid]::NewGuid().ToString('N') + '.json')
  try {
    $generator = $output + '.mjs'
    @'
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const {kioskLauncher}=await import(pathToFileURL(path.resolve('src/modules/dashboard/dashboardKioskLauncher.ts')).href);
const variants=[];
for(const protocol of ['http','https'])for(const browser of ['edge','chrome'])for(const fullscreen of [true,false])variants.push(kioskLauncher(`${protocol}://hospital.example/display/dashboards/1?deviceId=7`,{browser,fullscreen,screenNumber:1,windowX:-2000,windowY:100,windowWidth:1400,windowHeight:800}));
writeFileSync(process.argv[2],JSON.stringify(variants));
'@ | Set-Content -LiteralPath $generator -Encoding UTF8
    node --import tsx $generator $output
    if ($LASTEXITCODE -ne 0) { throw 'KIOSK_GENERATION_FAILED' }
    $variants = Get-Content -LiteralPath $output -Raw | ConvertFrom-Json
    foreach ($variant in $variants) {
      $tokens = $null; $parseErrors = $null
      [System.Management.Automation.Language.Parser]::ParseInput($variant.script, [ref]$tokens, [ref]$parseErrors) | Out-Null
      if ($parseErrors.Count -gt 0) { throw ('KIOSK_POWERSHELL_SYNTAX: ' + ($parseErrors | Out-String)) }
      if ($variant.bat -notmatch '-EncodedCommand ([A-Za-z0-9+/=]+)') { throw 'KIOSK_BAT_ENCODING' }
      if ([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($Matches[1])) -cne $variant.script) { throw 'KIOSK_BAT_ROUNDTRIP' }
      # Test launcher execution with browser/filesystem launch operations intercepted.
      $script:CapturedLaunch = $null
      function Test-Path { param($LiteralPath) return $true }
      function Start-Process { param($FilePath, $ArgumentList) $script:CapturedLaunch = @{ FilePath = $FilePath; Arguments = $ArgumentList } }
      & ([scriptblock]::Create($variant.script))
      if (-not $script:CapturedLaunch) { throw 'KIOSK_LAUNCH_NOT_CALLED' }
      $arguments = $script:CapturedLaunch.Arguments -join ' '
      if ($arguments -notlike '*--user-data-dir=*' -or $arguments -notlike '*--window-size=1400,800*' -or $arguments -notmatch '--app=https?://hospital\.example/display/dashboards/1\?deviceId=7') { throw 'KIOSK_ARGUMENTS_INVALID' }
      if ($arguments -match '(?i)token|incognito|inprivate|--kiosk') { throw 'KIOSK_FORBIDDEN_ARGUMENT' }
      Remove-Item Function:Test-Path, Function:Start-Process -ErrorAction SilentlyContinue
    }
    Write-Host 'KIOSK_WINDOWS_POWERSHELL_SYNTAX_AND_ARGUMENTS_PASS (mock launch; no physical browser/reboot acceptance)'
  } finally { Remove-Item -LiteralPath $output, $generator -Force -ErrorAction SilentlyContinue }
} finally { Pop-Location }
