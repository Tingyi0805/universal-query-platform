import type { Request } from "express";
import { getClientIp } from "../../utils/clientIp.js";

export function auditRequestContext(req: Request) {
  return {
    ipAddress: getClientIp(req),
    userAgent: req.get("user-agent") || null,
  };
}
