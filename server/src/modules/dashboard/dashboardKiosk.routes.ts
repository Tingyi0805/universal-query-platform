import { purgeDashboardDeviceSnapshots } from "./dashboardPageSnapshot.js";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getClientIp, normalizeIp } from "../../utils/clientIp.js";
import type { ExecutionSubject } from "./dashboardQuerySourceExecution.js";

type Configuration = { origin?: string; key?: string; enabled: boolean; trustedProxies: string[] };
type Dependencies = {
  check: typeof import("./dashboardDevice.repository.js").checkDashboardDisplayDevice;
  mode: (id: number) => Promise<{ mode: string; version: number }>;
  inspect: (id: number, subject: ExecutionSubject) => Promise<unknown>;
};
type Grant = { dashboardId: number; deviceId: number; token: string; version: number; expires: number; kind: "enrollment" | "session" };
const idSchema = z.coerce.number().int().positive().safe();
const grantSchema = z.object({ dashboardId: idSchema, deviceId: idSchema, token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), version: z.number().int().nonnegative(), expires: z.number().int().positive(), kind: z.enum(["enrollment", "session"]) }).strict();
export function kioskOrigin(value?: string) {
  if (!value) throw new Error("KIOSK_HTTPS_CONFIGURATION_REQUIRED");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== value || url.username || url.password || !/^[a-zA-Z0-9.:[\]-]+$/.test(url.host)) throw new Error("KIOSK_HTTPS_CONFIGURATION_REQUIRED");
  return url.origin;
}
// Encrypted, authenticated, purpose/origin-bound envelopes. The existing DB token hash is
// the revocation record; neither cookies nor a server restart create new device authority.
export function kioskCodec(origin: string, key: string) {
  if (!/^[a-fA-F0-9]{64}$/.test(key)) throw new Error("KIOSK_KEY_REQUIRED");
  const secret = Buffer.from(key, "hex"), aad = Buffer.from(`uqp-kiosk-v1:${kioskOrigin(origin)}`);
  return {
    seal(grant: Grant) { const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", secret, iv); cipher.setAAD(aad);
      return Buffer.concat([iv, cipher.update(JSON.stringify(grant)), cipher.final(), cipher.getAuthTag()]).toString("base64url"); },
    // allowExpired is used only to identify/purge an authenticated expired grant;
    // verify() still rejects it before inspect, renewal or delivery.
    open(value: string, kind: Grant["kind"], dashboardId: number, deviceId: number, allowExpired = false): Grant {
      if (!/^[A-Za-z0-9_-]{40,1500}$/.test(value)) throw new Error("KIOSK_UNAUTHORIZED");
      const data = Buffer.from(value, "base64url"), decipher = createDecipheriv("aes-256-gcm", secret, data.subarray(0,12));
      decipher.setAAD(aad); decipher.setAuthTag(data.subarray(-16));
      const grant = grantSchema.parse(JSON.parse(Buffer.concat([decipher.update(data.subarray(12,-16)), decipher.final()]).toString()));
      if (grant.kind !== kind || grant.dashboardId !== dashboardId || grant.deviceId !== deviceId || (!allowExpired && grant.expires <= Date.now())) throw new Error("KIOSK_UNAUTHORIZED");
      return grant;
    },
  };
}
export function createKioskRouter(configuration: () => Configuration, deps: Dependencies) {
  const router = Router();
  const name = (kind: Grant["kind"], deviceId: number) => `__Host-uqp-${kind}-${deviceId}`;
  const options = { httpOnly: true, secure: true, sameSite: "strict" as const, path: "/" };
  const clear = (res: Response, deviceId: number) => { for (const kind of ["enrollment", "session"] as const) res.clearCookie(name(kind,deviceId), options); };
  function secure(req: Request) {
    const config = configuration(), origin = kioskOrigin(config.origin);
    const trusted = config.trustedProxies.map(normalizeIp).includes(normalizeIp(req.socket.remoteAddress));
    const tls = (req.socket as import("node:tls").TLSSocket).encrypted === true || trusted && req.header("x-forwarded-proto") === "https";
    // All cookie requests, including layout GETs, require an explicit same-origin marker.
    // A cross-origin form/image/navigation and CORS preflight can never carry these proofs.
    if (!config.enabled || !tls || req.header("host") !== new URL(origin).host || (req.header("origin") !== origin && !(req.method === "GET" && !req.header("origin") && (!req.header("sec-fetch-site") || req.header("sec-fetch-site") === "same-origin"))) ||
      req.header("x-uqp-kiosk") !== "1" || req.header("sec-fetch-site") && req.header("sec-fetch-site") !== "same-origin" ||
      req.method === "POST" && !req.is("application/json")) throw new Error("KIOSK_SECURE_ORIGIN_REQUIRED");
    return kioskCodec(origin, config.key ?? "");
  }
  function cookie(req: Request, kind: Grant["kind"], deviceId: number) {
    const values = (req.header("cookie") ?? "").split(";").map(s=>s.trim()).filter(s=>s.startsWith(`${name(kind,deviceId)}=`));
    if (values.length !== 1) throw new Error("KIOSK_UNAUTHORIZED");
    return values[0]!.slice(name(kind,deviceId).length + 1);
  }
  async function verify(grant: Grant, req: Request) {
    if(grant.expires<=Date.now())throw new Error("KIOSK_UNAUTHORIZED");
    const current = await deps.check(grant.dashboardId, grant.token, getClientIp(req) ?? ""), mode = await deps.mode(grant.dashboardId);
    if (current.status !== "VALID" || current.device.id !== grant.deviceId || mode.mode !== "QUERY_ONLY" || mode.version !== grant.version ||
      current.device.queryModeGrantVersion !== mode.version || current.device.delegatorTokenVersion !== current.device.authorizationRevision) throw new Error("KIOSK_UNAUTHORIZED");
    return current.device;
  }
  async function inspect(grant: Grant, req: Request) {
    const device = await verify(grant, req);
    await deps.inspect(grant.dashboardId, { context: "device", deviceId: device.id, userId: device.createdByUserId,
      tokenVersion: device.authorizationRevision, tokenHash: createHash("sha256").update(grant.token).digest("hex"), verifyDevice: async () => {
        const {lastUsedAtUtc: _, ...current} = await verify(grant,req);
        return { deviceId: current.id, userId: current.createdByUserId, tokenVersion: current.authorizationRevision,
          fingerprint: createHash("sha256").update(JSON.stringify(current)).digest("hex") };
      } });
    return device;
  }
  for (const operation of ["enrollment", "session", "forget"] as const) router.post(`/device/:id/kiosk/${operation}`, async (req,res) => {
    res.setHeader("Cache-Control","no-store");
    let deviceId: number | undefined;
    let trusted = false;
    let proven: Grant | undefined;
    try {
      const codec = secure(req); trusted = true;
      const dashboardId = idSchema.parse(req.params.id);
      const input = z.object({deviceId: idSchema, ...(operation === "enrollment" ? {token: z.string().regex(/^[A-Za-z0-9_-]{43}$/)} : {})}).strict().parse(req.body);
      deviceId = input.deviceId;
      if (operation === "forget") { clear(res,deviceId); res.json({ forgotten: true }); return; }
      let grant: Grant;
      if (operation === "enrollment") {
        const mode = await deps.mode(dashboardId);
        grant = { dashboardId, deviceId, token: (input as {token: string}).token, version: mode.version, expires: Date.now() + 365*86400000, kind: "enrollment" };
      } else {grant = codec.open(cookie(req,"enrollment",deviceId),"enrollment",dashboardId,deviceId,true); proven=grant;}
      if(operation==="enrollment"){await verify(grant,req);proven=grant;}
      const device = await inspect(grant,req);
      if (operation === "enrollment") {
        if (device.expiresAtUtc) grant.expires = Math.min(grant.expires, Date.parse(device.expiresAtUtc));
        if (!Number.isSafeInteger(grant.expires) || grant.expires <= Date.now()) throw new Error("KIOSK_UNAUTHORIZED");
        res.cookie(name("enrollment",deviceId),codec.seal(grant),{...options,maxAge:grant.expires-Date.now()});
      }
      const expires = Math.min(grant.expires, device.expiresAtUtc ? Date.parse(device.expiresAtUtc) : Infinity, Date.now()+300000);
      if (!Number.isSafeInteger(expires) || expires <= Date.now()) throw new Error("KIOSK_UNAUTHORIZED");
      res.cookie(name("session",deviceId),codec.seal({...grant,kind:"session",expires}),{...options,maxAge:expires-Date.now()});
      res.json({deviceId, dashboardId, authorizationExpiresAt: expires});
    } catch {
      if (trusted && deviceId) clear(res,deviceId);
      if(proven)purgeDashboardDeviceSnapshots(proven.dashboardId,proven.deviceId);
      res.status(401).json({error:{code:"KIOSK_AUTHORIZATION_REQUIRED",message:"持久授權未通過；請確認 HTTPS 設定、裝置授權與政策，並重新啟用。"}});
    }
  });
  // Only short-lived sessions can reach existing page/layout handlers. Never expose the
  // unsealed token to JS, alternate APIs, URLs, audit bodies or error logs.
  router.use("/device/:id", async (req,res,next) => {
    if (!req.header("x-uqp-kiosk")) {
      if (!req.header("x-uqp-expected-device-id")) { next(); return; }
      try {
        const device = await deps.check(idSchema.parse(req.params.id),req.header("x-dashboard-device-token") ?? "",getClientIp(req) ?? "");
        if (device.status !== "VALID" || device.device.id !== idSchema.parse(req.header("x-uqp-expected-device-id"))) throw new Error("DEVICE_MISMATCH");
        next();
      } catch { res.setHeader("Cache-Control","no-store");res.status(401).json({error:{code:"DASHBOARD_DEVICE_UNAUTHORIZED"}}); }
      return;
    }
    res.setHeader("Cache-Control","no-store");
    let deviceId: number | undefined, trusted = false;
    let proven: Grant | undefined;
    try {
      const codec = secure(req); trusted = true;
      const dashboardId = idSchema.parse(req.params.id); deviceId = idSchema.parse(req.header("x-uqp-device-id"));
      if (req.header("x-dashboard-device-token") || !(req.method === "POST" && /^\/(?:data-sources\/[A-Za-z][A-Za-z0-9_]{0,63}\/)?page$/.test(req.path) || req.method === "GET" && req.path === "/layout")) throw new Error("KIOSK_UNAUTHORIZED");
      const grant = codec.open(cookie(req,"session",deviceId),"session",dashboardId,deviceId,true);
      proven=grant;
      res.on("finish",()=>{if(res.statusCode>=400)purgeDashboardDeviceSnapshots(dashboardId,deviceId!);});
      await inspect(grant,req);
      req.headers["x-dashboard-device-token"] = grant.token;
      next();
    } catch {
      if (trusted && deviceId) clear(res,deviceId);
      if(proven)purgeDashboardDeviceSnapshots(proven.dashboardId,proven.deviceId);
      res.status(401).json({error:{code:"KIOSK_AUTHORIZATION_REQUIRED",message:"裝置持久授權已失效，請重新授權。"}});
    }
  });
  return router;
}
