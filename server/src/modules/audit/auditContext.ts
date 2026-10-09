import type { Request } from "express";

export function auditRequestContext(req: Request) {
  return {
    ipAddress: req.ip || req.socket.remoteAddress || null,
    userAgent: req.get("user-agent") || null,
  };
}
