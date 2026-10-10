import type { Request } from "express";
import { env } from "../config/env.js";

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
  const socketIp = normalizeIp(req.socket.remoteAddress);
  if (!socketIp) return null;

  if (!env.TRUST_PROXY_ENABLED) {
    return socketIp;
  }

  const trusted = env.TRUSTED_PROXY_ADDRESSES
    .map(normalizeIp)
    .includes(socketIp);

  if (!trusted) {
    return socketIp;
  }

  return firstForwardedIp(req) || socketIp;
}
