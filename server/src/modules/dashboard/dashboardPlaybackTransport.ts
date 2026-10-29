import type { Request, RequestHandler } from "express";
import { normalizeIp } from "../../utils/clientIp.js";

// This is the existing TLS termination trust boundary, NOT proof of an agent
// application channel. No client header, DPAPI blob or localhost claim adds trust.
export function hasProtectedPlaybackTransport(req: Request, trustedProxies: string[]) {
  if ((req.socket as import("node:tls").TLSSocket).encrypted === true) return true;
  const peer = normalizeIp(req.socket.remoteAddress);
  return !!peer && trustedProxies.map(normalizeIp).includes(peer) && req.header("x-forwarded-proto") === "https";
}

export function devicePlaybackTransportGuard(trustedProxies: () => string[]): RequestHandler {
  return (req, res, next) => {
    if (hasProtectedPlaybackTransport(req, trustedProxies())) { next(); return; }
    res.setHeader("Cache-Control", "no-store");
    // No credential reflection, redirect, query, cookie, grant or automatic renewal.
    res.status(426).json({ error: { code: "DASHBOARD_PROTECTED_TRANSPORT_REQUIRED",
      message: "HTTP 裝置播放已停止：尚未提供經驗證的受管理播放端與加密資料通道（Issue #77 BLOCKED）。請勿透過此連線輸入 Device Token。" } });
  };
}
