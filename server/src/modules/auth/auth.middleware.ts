import type { Request, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import type { AuthUser } from "./auth.types.js";
import { getTokenSessionState } from "./auth.repository.js";

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

// Unforgeable by request JSON, headers, JWT decode or a hand-built req.authUser.
// Written only after jwt.verify AND current database session validation.
// A future CHART mutation route may read this value, but no route exists now.
const verifiedActors = new WeakMap<Request,Readonly<{userId:number;tokenVersion:number}>>();
export function readVerifiedJwtActor(req: Request):Readonly<{userId:number;tokenVersion:number}>|null {
  const actor=verifiedActors.get(req);
  return actor && req.authUser?.id===actor.userId &&
    req.authUser.permissions.includes("DESIGN_QUERY") ? actor : null;
}

export function createAuthenticateJwt(getSession = getTokenSessionState): RequestHandler {
  return async (req, res, next) => {
    // Drop any previously associated authority before authenticating.
    verifiedActors.delete(req);
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
      const userId = Number(payload.sub);
      const tokenVersion = Number(payload.tokenVersion);

      if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(tokenVersion) || tokenVersion < 1) {
        res.status(401).json({ error: { code: "INVALID_TOKEN", message: "登入憑證無效或已過期。" } });
        return;
      }

      const session = await getSession(userId);
      if (session === undefined) {
        res.status(503).json({ error: { code: "AUTH_NOT_CONFIGURED", message: "登入服務尚未設定。" } });
        return;
      }

      if (!session || !session.isActive || session.tokenVersion !== tokenVersion) {
        res.status(401).json({
          error: {
            code: "TOKEN_REVOKED",
            message: "登入狀態已失效，請重新登入。",
          },
        });
        return;
      }

      req.authUser = {
        id: userId,
        username: String(payload.username),
        displayName: String(payload.displayName),
        permissions: session.permissions,
      };
      verifiedActors.set(req,Object.freeze({userId,tokenVersion}));
      next();
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
        res.status(401).json({ error: { code: "INVALID_TOKEN", message: "登入憑證無效或已過期。" } });
        return;
      }
      next(error);
    }
  };
}
export const authenticateJwt = createAuthenticateJwt();

export const requirePermission = (permission: string): RequestHandler => (req, res, next) => {
  if (!req.authUser?.permissions.includes(permission)) {
    res.status(403).json({ error: { code: "FORBIDDEN", message: "沒有執行此功能的權限。" } });
    return;
  }
  next();
};
