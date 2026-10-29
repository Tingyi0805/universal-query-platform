# Production install: signed single-file EXE only. No bypass switch or secrets in arguments.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Executable,
  [Parameter(Mandatory=$true)][string]$Configuration,
  [Parameter(Mandatory=$true)][string]$WindowsUser,
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-F0-9]{64}$')][string]$ExpectedPublisherSha256
)
$ErrorActionPreference='Stop'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'ADMINISTRATOR_REQUIRED_FOR_PROTECTED_INSTALL' }
$sig=Get-AuthenticodeSignature -LiteralPath $Executable
if ($sig.Status -ne 'Valid' -or -not $sig.SignerCertificate) { throw 'TRUSTED_AUTHENTICODE_SIGNATURE_REQUIRED' }
$sha=[Security.Cryptography.SHA256]::Create()
try {
  $publisher=([BitConverter]::ToString($sha.ComputeHash($sig.SignerCertificate.RawData))).Replace('-','')
  if ($publisher -cne $ExpectedPublisherSha256) { throw 'PUBLISHER_PIN_MISMATCH' }
  $bytes=[IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $Configuration))
  try { $c=[Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json } catch { throw 'INVALID_PUBLIC_CONFIGURATION' }
  $allowed=@('ChannelEndpoint','PublicPlaybackUrl','ServerCertificateSha256','DashboardId','DeviceId','Placement')
  if (@($c.PSObject.Properties).Count -ne $allowed.Count -or @($c.PSObject.Properties.Name | Where-Object { $_ -cnotin $allowed }).Count -ne 0) { throw 'PUBLIC_CONFIGURATION_ONLY' }
  if ($c.ServerCertificateSha256 -cnotmatch '^[A-F0-9]{64}$' -or [long]$c.DashboardId -lt 1 -or [long]$c.DeviceId -lt 1) { throw 'INVALID_CONFIGURATION' }
  $placementKeys=@('ScreenNumber','WindowX','WindowY','WindowWidth','WindowHeight','Fullscreen')
  if (@($c.Placement.PSObject.Properties).Count -ne 6 -or @($c.Placement.PSObject.Properties.Name | Where-Object { $_ -cnotin $placementKeys }).Count -ne 0) { throw 'INVALID_PLACEMENT' }
  $endpoint=[Uri]$c.ChannelEndpoint;$public=[Uri]$c.PublicPlaybackUrl
  if ($endpoint.Scheme -ne 'http' -or $endpoint.GetLeftPart([UriPartial]::Authority) -cne $c.ChannelEndpoint -or $endpoint.UserInfo -or $public.Scheme -notin @('http','https') -or $public.UserInfo -or $public.Fragment -or $public.AbsolutePath -cne ('/display/dashboards/'+$c.DashboardId) -or $public.Query -cne ('?deviceId='+$c.DeviceId)) { throw 'INVALID_PUBLIC_URL' }
  $account=New-Object Security.Principal.NTAccount($WindowsUser)
  $sid=$account.Translate([Security.Principal.SecurityIdentifier])
  if ($sid.IsWellKnown([Security.Principal.WellKnownSidType]::LocalSystemSid)) { throw 'INTERACTIVE_LIMITED_USER_REQUIRED' }
  $digest=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').Substring(0,20)
  $destination=Join-Path $env:ProgramFiles ('UQPManagedKiosk\'+$digest)
  if (Test-Path -LiteralPath $destination) { throw 'INSTALL_TARGET_EXISTS_USE_VERIFIED_NEW_VERSION_OR_ROLLBACK' }
  New-Item -Path $destination -ItemType Directory | Out-Null
  $acl=New-Object Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true,$false)
  foreach ($entry in @(@('S-1-5-18','FullControl'),@('S-1-5-32-544','FullControl'),@($sid.Value,'ReadAndExecute'))) {
    $identity=New-Object Security.Principal.SecurityIdentifier($entry[0])
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,$entry[1],'ContainerInherit,ObjectInherit','None','Allow')))
  }
  Set-Acl -LiteralPath $destination -AclObject $acl
  $app=Join-Path $destination 'Uqp.Kiosk.Agent.exe';$config=Join-Path $destination 'agent.json'
  Copy-Item -LiteralPath $Executable -Destination $app
  $installed=Get-AuthenticodeSignature -LiteralPath $app
  if ($installed.Status -ne 'Valid' -or ([BitConverter]::ToString($sha.ComputeHash($installed.SignerCertificate.RawData))).Replace('-','') -cne $ExpectedPublisherSha256) { throw 'INSTALLED_SIGNATURE_PIN_MISMATCH' }
  [IO.File]::WriteAllBytes($config,$bytes)
  # Interactive logon under the enrolled user's SID. No stored Windows password or SYSTEM session.
  $urlBytes=[Text.Encoding]::UTF8.GetBytes([string]$c.PublicPlaybackUrl)
  $urlKey=([BitConverter]::ToString($sha.ComputeHash($urlBytes))).Replace('-','').ToLowerInvariant()
  $mapping='HKLM:\SOFTWARE\UQP\ManagedKiosk\'+$sid.Value+'\'+$urlKey
  New-Item -Path $mapping -Force | Out-Null
  New-ItemProperty -Path $mapping -Name Executable -Value $app -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $mapping -Name Configuration -Value $config -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $mapping -Name PublisherSha256 -Value $ExpectedPublisherSha256 -PropertyType String -Force | Out-Null
  $task='UQP.ManagedKiosk.'+$digest
  $action=New-ScheduledTaskAction -Execute $app -Argument ('--config "'+$config+'"')
  $trigger=New-ScheduledTaskTrigger -AtLogOn -User $WindowsUser
  $principal=New-ScheduledTaskPrincipal -UserId $WindowsUser -LogonType Interactive -RunLevel Limited
  $settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Seconds 30)
  Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
  $bat='@echo off'+"`r`n"+'start "" "'+$app+'" --config "'+$config+'"'+"`r`n"
  [IO.File]::WriteAllText((Join-Path $destination 'Open-Managed-Kiosk.bat'),$bat,[Text.Encoding]::ASCII)
  Write-Host ('Installed managed interactive task: '+$task)
  Write-Host ('Public launcher: '+(Join-Path $destination 'Open-Managed-Kiosk.bat'))
} finally { $sha.Dispose() }
