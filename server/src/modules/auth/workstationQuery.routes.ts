import { Router, type Request } from "express";
import type sql from "mssql";
import { QueryDeliveryError, type RuntimeIdentity } from "../queryDefinition/queryDelivery.js";
import { createQueryRuntimeRouter, defaultQueryRuntimeDependencies } from "../queryDefinition/queryRuntime.routes.js";
import { workstationSessions } from "./workstationSession.repository.js";
import { readOpaqueCookie, credentialCookie, sessionCookie } from "./workstationCookies.js";

export function createWorkstationQueryRouter(sessions = workstationSessions,
  deps = defaultQueryRuntimeDependencies) {
  const router = Router();
  const identity = async (req: Request, tx?: sql.Transaction): Promise<RuntimeIdentity> => {
    const credential = readOpaqueCookie(req.headers.cookie, credentialCookie), token = readOpaqueCookie(req.headers.cookie, sessionCookie);
    const actor = credential && token ? await sessions.read(token, credential, tx) : null;
    if (!actor) throw new QueryDeliveryError("PIN_SESSION_INVALID", 401);
    return { userId: actor.userId, tokenVersion: actor.tokenVersion, permissions: actor.permissions,
      pinSession: { sessionId: actor.sessionId, generation: actor.generation, credentialVersion: actor.credentialVersion, pinVersion: actor.pinVersion } };
  };
  const delivery = deps.delivery;
  router.get("/", async (req, res, next) => {
    try {
      const actor = await identity(req);
      const queries = await deps.listAccessibleQueries(actor.userId);
      const safe: { id: number; code: string; name: string }[] = [];
      const contexts: Awaited<ReturnType<typeof delivery.open>>[] = [];
      for (const query of queries) {
        try {
          const context = await delivery.open(query.id, "VIEW", tx => identity(req, tx));
          if (context.actor.pinSession?.sessionId !== actor.pinSession?.sessionId) throw new QueryDeliveryError("PIN_SESSION_INVALID", 401);
          safe.push({ id: context.query.id, code: context.query.code, name: context.query.name });
          contexts.push(context);
        } catch (error) {
          if (!(error instanceof QueryDeliveryError) || error.status !== 403) throw error;
        }
      }
      for (const context of contexts) await context.revalidate();
      const current = await identity(req);
      if (JSON.stringify(current) !== JSON.stringify(actor)) throw new QueryDeliveryError("PIN_SESSION_INVALID", 401);
      res.json({ queries: safe });
    } catch (error) { next(error); }
  });
  // Reuse the existing runtime's metadata, fixed options, QueryDelivery engine,
  // serialization and final Audit coordinator. PIN cannot reach favorites,
  // exports, Dataset management, drill-down contexts or any JWT-only endpoint.
  router.use((req, res, next) => {
    if (!((req.method === "GET" && /^\/\d+(?:\/parameters\/[A-Z][A-Z0-9_]*\/options)?\/?$/.test(req.path))
      || (req.method === "POST" && /^\/\d+\/execute\/?$/.test(req.path)))) {
      res.status(403).json({ error: { code: "PIN_ASSURANCE_REQUIRED" } }); return;
    }
    next();
  });
  router.use(createQueryRuntimeRouter({ ...deps, delivery,
    authenticate: async (req, res, next) => {
      try {
        const actor = await identity(req);
        req.authUser = { id: actor.userId, username: "", displayName: "", permissions: actor.permissions };
        next();
      } catch (error) { next(error); }
    },
  }, identity));
  return router;
}
