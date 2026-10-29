// A browser secure-context flag also accepts HTTP localhost; that does not
// authenticate the server or protect patient rows. No loopback/agent exception.
export function devicePlaybackTransportAvailable(protocol: string) {
  return protocol === "https:";
}
export function assertDevicePlaybackTransport(protocol: string) {
  if (!devicePlaybackTransportAvailable(protocol)) throw Object.assign(new Error(
    "請使用 Windows Managed Kiosk Agent；一般 HTTP 網頁不具備安全播放通道，請勿輸入 Device Token。"
  ), { code: "DASHBOARD_PROTECTED_TRANSPORT_REQUIRED", status: 426 });
}
