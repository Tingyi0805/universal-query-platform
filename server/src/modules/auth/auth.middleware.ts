import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import type { AuthUser } from "./auth.types.js";

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

export const authenticateJwt: RequestHandler = (req, res, next) => {
  if (!env.JWT_SECRET) {
    res.status(503).json({ error: { code: "AUTH_NOT_CONFIGURED", message: "登入服務尚未設定。" } });
    return;
  }

  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "需要登入。" } });
    return;
  }

  try {
    const payload = jwt.verify(header.slice(7), env.JWT_SECRET) as jwt.JwtPayload;
    req.authUser = {
      id: Number(payload.sub),
      username: String(payload.username),
      displayName: String(payload.displayName),
      permissions: Array.isArray(payload.permissions) ? payload.permissions.map(String) : [],
    };
    next();
  } catch {
    res.status(401).json({ error: { code: "INVALID_TOKEN", message: "登入憑證無效或已過期。" } });
  }
};

export const requirePermission = (permission: string): RequestHandler => (req, res, next) => {
  if (!req.authUser?.permissions.includes(permission)) {
    res.status(403).json({ error: { code: "FORBIDDEN", message: "沒有執行此功能的權限。" } });
    return;
  }
  next();
};
