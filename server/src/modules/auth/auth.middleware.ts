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
// CHART routes use this proof only after the independently reviewed HTTP gate.
const verifiedActors = new WeakMap<Request,Readonly<{
  userId:number;tokenVersion:number;designQueryAllowed:boolean;
  executeQueryAllowed:boolean; originalBearerHeader:string;
}>>();
export function readVerifiedJwtActor(req: Request):Readonly<{userId:number;tokenVersion:number}>|null {
  const actor=verifiedActors.get(req);
  // req.authUser is mutable request context, not a new source of authority.
  // Permission must already have existed in the live DB session verified by
  // this middleware; later replacement of req.authUser cannot grant it.
  if(!actor?.designQueryAllowed || req.authUser?.id!==actor.userId ||
     !Array.isArray(req.authUser.permissions) ||
     !req.authUser.permissions.includes("DESIGN_QUERY"))return null;
  return {userId:actor.userId,tokenVersion:actor.tokenVersion};
}

/** Chart-only immutable, verified JWT and live-DB EXECUTE_QUERY scope.
 * Never reconstruct the bearer from a later, mutable request header: the
 * independent signer must verify the ORIGINAL JWT that was authenticated.
 * Do not expose originalBearerHeader in logs, API results or browser code.
 */
export function readVerifiedChartExecuteActor(req: Request):Readonly<{
  userId:number;tokenVersion:number;originalBearerHeader:string;
}>|null {
  const actor=readVerifiedJwtActor(req);
  const proof=verifiedActors.get(req);
  if(!actor||!proof?.executeQueryAllowed||
     !req.authUser?.permissions.includes("EXECUTE_QUERY")||
     !/^Bearer [A-Za-z0-9_.-]+$/.test(proof.originalBearerHeader))return null;
  return {
    userId:actor.userId,tokenVersion:actor.tokenVersion,
    originalBearerHeader:proof.originalBearerHeader,
  };
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
      verifiedActors.set(req,Object.freeze({
        userId,tokenVersion,
        designQueryAllowed:session.permissions.includes("DESIGN_QUERY"),
        executeQueryAllowed:session.permissions.includes("EXECUTE_QUERY"),
        originalBearerHeader:header,
      }));
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
