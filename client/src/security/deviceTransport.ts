// A browser secure-context flag also accepts HTTP localhost; that does not
// authenticate the server or protect patient rows. No loopback/agent exception.
export function devicePlaybackTransportAvailable(protocol: string) {
  return protocol === "https:";
}
export function assertDevicePlaybackTransport(protocol: string) {
  if (!devicePlaybackTransportAvailable(protocol)) throw Object.assign(new Error(
    "HTTP 裝置播放已停止：受管理播放端與加密資料通道尚未完成（Issue #77 BLOCKED）。請勿輸入 Device Token。"
  ), { code: "DASHBOARD_PROTECTED_TRANSPORT_REQUIRED", status: 426 });
}
