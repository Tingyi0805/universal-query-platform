import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { getClientIp } from "../../utils/clientIp.js";
import { auditRequestContext } from "../audit/auditContext.js";
import { parsePinPepper } from "./pinVerifier.js";
import { credentialCookie, sessionCookie, readOpaqueCookie, setOpaqueCookie, clearPinSession,
  workstationBoundary, workstationCsrf, matchesWorkstationCsrf, parseOpaqueToken } from "./workstationCookies.js";
import { workstationSessions, pinIdleSeconds } from "./workstationSession.repository.js";
import { workstationPinService } from "./workstationPin.service.js";
import { createWorkstationQueryRouter } from "./workstationQuery.routes.js";
import { QueryDeliveryError } from "../queryDefinition/queryDelivery.js";

export const defaultWorkstationPinRouteDependencies = {
  enabled: () => env.WORKSTATION_PIN_RUNTIME,
  origin: () => env.WORKSTATION_PIN_ORIGIN,
  key: () => parsePinPepper(env.WORKSTATION_PIN_PEPPER_ID, env.WORKSTATION_PIN_PEPPER).key,
  sessions: workstationSessions, service: workstationPinService,
};
export function createWorkstationPinRouter(deps = defaultWorkstationPinRouteDependencies) {
  const router = Router();
  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (!deps.enabled()) { res.status(404).json({ error: { code: "NOT_FOUND" } }); return; }
    if (!workstationBoundary(req, deps.origin(), req.method !== "GET")) {
      res.status(403).json({ error: { code: "PIN_ORIGIN_REQUIRED" } }); return;
    }
    try {
      deps.key();
      if (req.path === "/pair" && req.method === "POST") { next(); return; }
      const credential = readOpaqueCookie(req.headers.cookie, credentialCookie);
      const session = readOpaqueCookie(req.headers.cookie, sessionCookie);
      if (!credential) { res.status(401).json({ error: { code: "PIN_CREDENTIAL_REQUIRED" } }); return; }
      if (req.method !== "GET" && !matchesWorkstationCsrf(req.headers["x-workstation-csrf"], workstationCsrf(deps.key(), credential, session))) {
        res.status(403).json({ error: { code: "PIN_CSRF_REQUIRED" } }); return;
      }
      res.locals.pinCredential = credential;
      res.locals.pinSession = session;
      next();
    } catch (error) { next(error); }
  });
  router.post("/pair", async (req, res, next) => {
    try {
      // Same-origin custom header and JSON prevent form/navigation pairing CSRF.
      const value = req.body?.credential;
      if (req.headers["x-workstation-pair"] !== "1" || !req.is("application/json") || typeof value !== "string" || !parseOpaqueToken(value)) {
        res.status(400).json({ error: { code: "PIN_PAIR_INVALID" } }); return;
      }
      const old = readOpaqueCookie(req.headers.cookie, credentialCookie);
      if (old && old !== value) { res.status(409).json({ error: { code: "PIN_ALREADY_PAIRED" } }); return; }
      if (!await deps.sessions.credential(value)) { res.status(401).json({ error: { code: "PIN_CREDENTIAL_INVALID" } }); return; }
      await deps.service.lock(value, auditRequestContext(req));
      setOpaqueCookie(res, credentialCookie, value, 30 * 24 * 60 * 60 * 1000);
      clearPinSession(res);
      res.json({ status: "OK", csrfToken: workstationCsrf(deps.key(), value, null) });
    } catch (error) { next(error); }
  });
  router.get("/session", async (req, res, next) => {
    try {
      const credential = String(res.locals.pinCredential), session = res.locals.pinSession as string | null;
      if (!await deps.sessions.credential(credential)) { res.status(401).json({ error: { code: "PIN_CREDENTIAL_INVALID" } }); return; }
      const actor = await deps.service.current(session, credential, auditRequestContext(req));
      // Keep the current opaque cookie for CSRF binding, even when expired.
      res.json({ user: actor ? { id: actor.userId, username: actor.username, displayName: actor.displayName } : null,
        sessionId: actor?.sessionId ?? null, idleSeconds: pinIdleSeconds,
        csrfToken: workstationCsrf(deps.key(), credential, session) });
    } catch (error) { next(error); }
  });
  for (const path of ["/login", "/switch"]) router.post(path, async (req, res, next) => {
    try {
      const body = z.object({ username: z.string().trim().min(1).max(100), pin: z.string().regex(/^\d{4,12}$/) }).strict().safeParse(req.body);
      const network = getClientIp(req);
      if (!body.success || !network) {
        // A structurally invalid B attempt is still a switch intent: A must
        // remain revoked rather than silently staying usable behind a cleared UI.
        await deps.service.lock(String(res.locals.pinCredential), auditRequestContext(req));
        res.status(400).json({ error: { code: "PIN_INPUT_INVALID" } }); return;
      }
      const result = await deps.service.login({ ...body.data, credential: String(res.locals.pinCredential), network, audit: auditRequestContext(req) });
      if (result.status !== "OK") {
        // Do not send an expired Set-Cookie: a late failed A->B response must
        // not delete the successful cookie from a later B->C intent.
        res.status(result.status === "LOCKED" ? 429 : 401).json({ error: { code: "PIN_SIGN_IN_FAILED" } }); return;
      }
      const actor = await deps.sessions.read(result.token, String(res.locals.pinCredential));
      if (!actor) { res.status(409).json({ error: { code: "PIN_SWITCH_STALE" } }); return; }
      setOpaqueCookie(res, sessionCookie, result.token);
      res.json({ user: { id: actor.userId, username: actor.username, displayName: actor.displayName }, sessionId: actor.sessionId,
        idleSeconds: pinIdleSeconds, csrfToken: workstationCsrf(deps.key(), String(res.locals.pinCredential), result.token) });
    } catch (error) { next(error); }
  });
  for (const path of ["/lock", "/logout"]) router.post(path, async (req, res, next) => {
    try {
      await deps.service.lock(String(res.locals.pinCredential), auditRequestContext(req));
      // Retain opaque cookie to avoid an old lock response clearing a newer session.
      res.json({ status: "OK" });
    } catch (error) { next(error); }
  });
  router.post("/activity", async (_req, res, next) => {
    try {
      const actor = res.locals.pinSession ? await deps.service.activity(String(res.locals.pinSession), String(res.locals.pinCredential)) : null;
      if (!actor) { res.status(401).json({ error: { code: "PIN_SESSION_INVALID" } }); return; }
      res.json({ status: "OK", sessionId: actor.sessionId });
    } catch (error) { next(error); }
  });
  router.use("/queries", createWorkstationQueryRouter(deps.sessions));
  // Stable errors only. Never expose SQL driver errors or credential values.
  router.use((error: unknown, _req: import("express").Request, res: import("express").Response, _next: import("express").NextFunction) => {
    const code = error instanceof Error ? error.message : "";
    const status = error instanceof QueryDeliveryError ? error.status : code === "PIN_SWITCH_STALE" ? 409 : code === "PIN_CREDENTIAL_INVALID" ? 401 : 503;
    res.status(status).json({ error: { code: status === 503 ? "PIN_SERVICE_UNAVAILABLE" : code } });
  });
  return router;
}
