import type { Request, RequestHandler } from "express";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { forwardedIp, normalizeIp } from "./ipAddress.js";
export { normalizeIp } from "./ipAddress.js";

function singleHeader(req: Request, name: string): string | undefined {
  if ((req.rawHeaders ?? []).filter((_, i, all) => i % 2 === 0 && all[i]?.toLowerCase() === name).length > 1) return undefined;
  const value = req.headers[name];
  return typeof value === "string" ? value : undefined;
}
const configuredProxies = () => env.TRUST_PROXY_ENABLED ? env.TRUSTED_PROXY_ADDRESSES : [];

export function requestNetwork(req: Request, trustedAddresses = configuredProxies()) {
  const peer = normalizeIp(req.socket.remoteAddress);
  const trusted = new Set(trustedAddresses.map(normalizeIp).filter(Boolean));
  const viaTrustedProxy = !!peer && trusted.has(peer);
  const directTls = (req.socket as import("node:tls").TLSSocket).encrypted === true;
  if (!viaTrustedProxy) return { clientIp: peer || null, secure: directTls, viaTrustedProxy, valid: !!peer };
  const forwarded = singleHeader(req, "x-forwarded-for"), proto = singleHeader(req, "x-forwarded-proto");
  const chain = forwarded && forwarded.length <= 4096 ? forwarded.split(",").map(forwardedIp) : [];
  if (!chain.length || chain.length > 32 || chain.some(ip => !ip) || !["http", "https"].includes(proto ?? "")) {
    return { clientIp: null, secure: false, viaTrustedProxy, valid: false };
  }
  // Walk from the real TCP peer towards the client. Stop at the first untrusted
  // address: anything to its left may have been supplied by that caller.
  let clientIp = peer;
  for (let i = chain.length - 1; i >= 0 && trusted.has(clientIp); i--) clientIp = chain[i]!;
  return { clientIp, secure: directTls || proto === "https", viaTrustedProxy, valid: true };
}

export function getClientIp(req: Request): string | null {
  const network = requestNetwork(req);
  if (env.CLIENT_IP_DIAGNOSTICS) logger.info({ socketIp: normalizeIp(req.socket.remoteAddress),
    trustedProxy: network.viaTrustedProxy, forwardedMetadataValid: network.valid,
    resolvedClientIp: network.clientIp }, "Client IP diagnostics");
  return network.clientIp;
}

// ARR's global preserveHostHeader may be off for other sites. A site-scoped,
// overwritten forwarded Host is usable only from the same explicitly trusted peer.
// The cookie boundary must still compare this value to its pinned public origin.
export function requestHost(req: Request, trustedAddresses = configuredProxies()): string | null {
  const network = requestNetwork(req,trustedAddresses);
  if (network.viaTrustedProxy && req.headers["x-forwarded-host"] !== undefined) {
    return network.valid ? singleHeader(req,"x-forwarded-host") ?? null : null;
  }
  return singleHeader(req,"host") ?? null;
}

// Never turn malformed proxy metadata into a loopback identity in IP ACLs/Audit.
export const validateProxyRequest: RequestHandler = (req, res, next) => {
  const network = requestNetwork(req);
  if (network.viaTrustedProxy && !network.valid) {
    res.setHeader("Cache-Control", "no-store");
    res.status(400).json({ error: { code: "PROXY_METADATA_INVALID", message: "受信任代理的來源資訊不完整或無效，請確認 IIS ARR 設定。" } });
    return;
  }
  next();
};
