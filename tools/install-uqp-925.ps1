# Explicitly approved, separate installer identity only. PowerShell 5.1.
param([ValidateSet('Preflight','Verify','Apply')][string]$Mode='Preflight')
$ErrorActionPreference='Stop'
$serverDir=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\server'))
$names=@('PLATFORM_DB_USER','PLATFORM_DB_PASSWORD','UQP_925_EXPECTED_SERVER','UQP_925_EXPECTED_DATABASE','UQP_925_EXPECTED_LOGIN')
$previous=@{}
foreach($name in $names){$previous[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
try {
 $env:UQP_925_EXPECTED_SERVER=Read-Host 'Expected SQL @@SERVERNAME (confirm independently in SSMS)'
 $env:UQP_925_EXPECTED_DATABASE=Read-Host 'Expected database (approved maintenance target)'
 $env:UQP_925_EXPECTED_LOGIN=Read-Host 'Separate installer login (effective dbo, never elevate runtime)'
 if([string]::IsNullOrWhiteSpace($env:UQP_925_EXPECTED_SERVER) -or [string]::IsNullOrWhiteSpace($env:UQP_925_EXPECTED_DATABASE) -or [string]::IsNullOrWhiteSpace($env:UQP_925_EXPECTED_LOGIN)){throw '925_EXPLICIT_TARGET_REQUIRED'}
 $env:PLATFORM_DB_USER=$env:UQP_925_EXPECTED_LOGIN
 $secure=Read-Host 'Installer password (not saved)' -AsSecureString
 $ptr=[IntPtr]::Zero
 try {$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure);$env:PLATFORM_DB_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)} finally {if($ptr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)};$secure.Dispose()}
 if($Mode -eq 'Apply' -and (Read-Host 'Backup/restore drill, approved downtime and exact target confirmed? Type INSTALL 925') -cne 'INSTALL 925'){throw '925_NOT_APPROVED'}
 Push-Location $serverDir
 try {if($Mode -eq 'Apply'){& npx.cmd tsx src/scripts/installDataset925.ts apply --confirm}else{& npx.cmd tsx src/scripts/installDataset925.ts $Mode.ToLowerInvariant()};if($LASTEXITCODE -ne 0){throw '925_INSTALLER_FAILED'}} finally {Pop-Location}
} finally {foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')}}
