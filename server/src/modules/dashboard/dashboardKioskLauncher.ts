import { createHash } from "node:crypto";
import { devicePlacementSchema } from "./dashboardDeviceManagement.schema.js";
import { kioskOrigin } from "./dashboardKiosk.routes.js";
export function kioskPlaybackLink(origin: string | undefined, dashboardId: number, deviceId: number) {
  if (![dashboardId,deviceId].every(id=>Number.isSafeInteger(id)&&id>0)) throw new Error("KIOSK_DEVICE_INVALID");
  return `${kioskOrigin(origin)}/display/dashboards/${dashboardId}?deviceId=${deviceId}`;
}
export function manualPlaybackLink(origin: string | undefined, dashboardId: number, deviceId: number) {
  if(!origin)throw new Error("PLAYBACK_ORIGIN_REQUIRED");
  const url=new URL(origin);
  if(!["http:","https:"].includes(url.protocol) || url.origin!==origin || url.username || url.password || !/^[a-zA-Z0-9.:[\]-]+$/.test(url.host) || ![dashboardId,deviceId].every(id=>Number.isSafeInteger(id)&&id>0))throw new Error("PLAYBACK_ORIGIN_INVALID");
  return `${origin}/display/dashboards/${dashboardId}?deviceId=${deviceId}`;
}
export function kioskLauncher(url: string, placement: unknown) {
  const parsed = new URL(url);
  if (manualPlaybackLink(parsed.origin, Number(parsed.pathname.split("/").pop()), Number(parsed.searchParams.get("deviceId"))) !== url) throw new Error("KIOSK_URL_INVALID");
  const p = devicePlacementSchema.parse(placement), deviceId = Number(parsed.searchParams.get("deviceId"));
  const profile = `UQP\\Kiosk\\${createHash("sha256").update(parsed.origin).digest("hex").slice(0,16)}\\device-${deviceId}`;
  // No InPrivate/incognito/Edge kiosk switch: those modes discard persistent cookies.
  // EncodedCommand contains only public URL and saved placement, preventing CMD URL
  // metacharacter/percent expansion. It is NOT a way to store or obscure credentials.
  const urlKey=createHash("sha256").update(url).digest("hex");
  const nativePlacement=Buffer.from(JSON.stringify({ScreenNumber:p.screenNumber,WindowX:p.windowX,WindowY:p.windowY,WindowWidth:p.windowWidth,WindowHeight:p.windowHeight,Fullscreen:p.fullscreen})).toString("base64");
  const script = `$ErrorActionPreference='Stop'
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$agentKey='HKLM:\\SOFTWARE\\UQP\\ManagedKiosk\\'+$sid+'\\${urlKey}'
if(Test-Path -LiteralPath $agentKey){
 $entry=Get-ItemProperty -LiteralPath $agentKey
 $signature=Get-AuthenticodeSignature -LiteralPath $entry.Executable
 if($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate){throw 'Managed agent signature is invalid'}
 $sha=[Security.Cryptography.SHA256]::Create()
 try{$publisher=([BitConverter]::ToString($sha.ComputeHash($signature.SignerCertificate.RawData))).Replace('-','')}finally{$sha.Dispose()}
 if($publisher -cne $entry.PublisherSha256){throw 'Managed agent publisher is invalid'}
 $arguments='--config "{0}" --placement-base64 ${nativePlacement}' -f $entry.Configuration
 Start-Process -FilePath $entry.Executable -ArgumentList $arguments
 return
}
${parsed.protocol==="http:"?"throw 'Install and enroll the trusted Windows Managed Kiosk Agent before HTTP playback'":""}
Add-Type -AssemblyName System.Windows.Forms
$screens=@([System.Windows.Forms.Screen]::AllScreens | Sort-Object DeviceName)
if($screens.Count -lt ${p.screenNumber}){throw 'Configured screen is unavailable'}
$screen=$screens[${p.screenNumber-1}]
$x=${p.windowX};$y=${p.windowY}
if(-not $screen.Bounds.Contains($x,$y)){$x=$screen.Bounds.X;$y=$screen.Bounds.Y}
$profile=Join-Path $env:LOCALAPPDATA '${profile}'
$paths=@(${p.browser === "edge" ? "'Microsoft\\Edge\\Application\\msedge.exe'" : "'Google\\Chrome\\Application\\chrome.exe'"})
$browser=$null
foreach($root in @($env:ProgramFiles,\${env:ProgramFiles(x86)},$env:LOCALAPPDATA)){if($root){$candidate=Join-Path $root $paths[0];if(Test-Path -LiteralPath $candidate){$browser=$candidate;break}}}
if(-not $browser){throw 'Configured browser is not installed'}
$profileArgument='--user-data-dir="{0}"' -f $profile
$positionArgument='--window-position={0},{1}' -f $x,$y
$launchArgs=@($profileArgument,'--new-window',$positionArgument,'--window-size=${p.windowWidth},${p.windowHeight}','--app=${url}'${p.fullscreen ? ", '--start-fullscreen'" : ""})
Start-Process -FilePath $browser -ArgumentList $launchArgs
`;
  return { bat: `@echo off\r\nsetlocal\r\nREM UQP device ${deviceId}: public URL only; no authorization secrets.\r\n${parsed.protocol==="http:" ? "REM HTTP browser playback BLOCKED. Use the installed Windows Managed Kiosk Agent launcher.\r\nREM This URL opens a blocked status page; do not enter credentials.\r\n" : ""}REM Screen order uses Windows DeviceName; coordinates are physical desktop pixels.\r\npowershell.exe -NoLogo -NoProfile -EncodedCommand ${Buffer.from(script,"utf16le").toString("base64")}\r\nif errorlevel 1 pause\r\nendlocal\r\n`, script };
}
