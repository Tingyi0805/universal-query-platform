import type { Request } from "express";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

export function normalizeIp(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (raw.startsWith("::ffff:")) return raw.slice(7);
  return raw;
}

function firstForwardedIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (!raw) return "";
  return normalizeIp(String(raw).split(",")[0]);
}

export function getClientIp(req: Request): string | null {
  const rawSocketIp = req.socket.remoteAddress ?? null;
  const socketIp = normalizeIp(rawSocketIp);
  const forwardedFor = req.headers["x-forwarded-for"];
  const xRealIp = req.headers["x-real-ip"];
  const firstForwarded = firstForwardedIp(req);

  if (!socketIp) {
    if (env.CLIENT_IP_DIAGNOSTICS) {
      logger.info({
        rawSocketIp,
        socketIp: null,
        xForwardedFor: forwardedFor ?? null,
        xRealIp: xRealIp ?? null,
        trustProxyEnabled: env.TRUST_PROXY_ENABLED,
        trustedProxyAddresses: env.TRUSTED_PROXY_ADDRESSES,
        trustedProxy: false,
        firstForwardedIp: firstForwarded || null,
        resolvedClientIp: null,
      }, "Client IP diagnostics");
    }
    return null;
  }

  const trusted = env.TRUST_PROXY_ENABLED && env.TRUSTED_PROXY_ADDRESSES
    .map(normalizeIp)
    .includes(socketIp);

  const resolvedClientIp = trusted && firstForwarded
    ? firstForwarded
    : socketIp;

  if (env.CLIENT_IP_DIAGNOSTICS) {
    logger.info({
      rawSocketIp,
      socketIp,
      xForwardedFor: forwardedFor ?? null,
      xRealIp: xRealIp ?? null,
      trustProxyEnabled: env.TRUST_PROXY_ENABLED,
      trustedProxyAddresses: env.TRUSTED_PROXY_ADDRESSES,
      trustedProxy: trusted,
      firstForwardedIp: firstForwarded || null,
      resolvedClientIp,
    }, "Client IP diagnostics");
  }

  return resolvedClientIp;
}
