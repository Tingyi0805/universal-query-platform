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
      message: "一般 HTTP 網頁不具備安全播放通道；請使用已安裝並授權的 Windows Managed Kiosk Agent。請勿透過此連線輸入 Device Token。" } });
  };
}
