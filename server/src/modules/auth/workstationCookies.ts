import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { requestHost, requestNetwork } from "../../utils/clientIp.js";

export const credentialCookie = "__Host-uqp-workstation";
export const sessionCookie = "__Host-uqp-pin-session";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const secret = /^[A-Za-z0-9_-]{43}$/;

/** Reject duplicates rather than allowing parsers/proxies to choose different credentials. */
export function readOpaqueCookie(header: string | undefined, name: string): string | null {
  if (!header || header.length > 8192) return null;
  const values = header.split(";").map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const value = values[0]!.slice(name.length + 1);
  return parseOpaqueToken(value) ? value : null;
}
export function parseOpaqueToken(value: string): { id: string; secret: string } | null {
  const parts = value.split(".");
  return parts.length === 2 && uuid.test(parts[0]!) && secret.test(parts[1]!)
    && Buffer.from(parts[1]!, "base64url").toString("base64url") === parts[1]
    ? { id: parts[0]!.toLowerCase(), secret: parts[1]! } : null;
}
export function setOpaqueCookie(res: Response, name: string, value: string, maxAge?: number) {
  if (![credentialCookie, sessionCookie].includes(name) || !parseOpaqueToken(value)) throw new Error("PIN_COOKIE_INVALID");
  res.cookie(name, value, { secure: true, httpOnly: true, sameSite: "strict", path: "/", ...(maxAge === undefined ? {} : { maxAge }) });
}
export function clearPinSession(res: Response) {
  res.clearCookie(sessionCookie, { secure: true, httpOnly: true, sameSite: "strict", path: "/" });
}

/** Pinned HTTPS origin; proxy headers are usable only through the existing trusted resolver. */
export function workstationBoundary(req: Request, configuredOrigin: string | undefined, mutation: boolean): boolean {
  let origin: URL;
  try { origin = new URL(configuredOrigin ?? ""); } catch { return false; }
  if (origin.protocol !== "https:" || origin.origin !== configuredOrigin || origin.username || origin.password) return false;
  const network = requestNetwork(req);
  if (!network.valid || !network.secure || requestHost(req)?.toLowerCase() !== origin.host.toLowerCase()) return false;
  if (req.headers.authorization || req.headers["x-dashboard-device-token"] || req.headers["x-workstation-credential"]) return false;
  if (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin") return false;
  return mutation ? req.headers.origin === origin.origin : !req.headers.origin || req.headers.origin === origin.origin;
}

/** Token is returned in a same-origin JSON response, never in a cookie or URL.
 * Binding to both cookies makes a pre-login CSRF token invalid after login.
 */
export function workstationCsrf(key: Buffer, credential: string, session: string | null): string {
  if (key.length !== 32 || !parseOpaqueToken(credential) || (session !== null && !parseOpaqueToken(session))) throw new Error("PIN_CSRF_INPUT_INVALID");
  return createHmac("sha256", key).update("uqp:pin-csrf:v1\0").update(credential).update("\0").update(session ?? "").digest("base64url");
}
export function matchesWorkstationCsrf(candidate: unknown, expected: string): boolean {
  return typeof candidate === "string" && secret.test(candidate) && candidate.length === expected.length
    && timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}

/** Persist only a hash; live credential version and switch generation are part
 * of the binding, so rotation/switch invalidates the old opaque session.
 */
export function pinSessionHash(token: string, credential: string, version: number, generation: string): Buffer {
  if (!parseOpaqueToken(token) || !parseOpaqueToken(credential) || !Number.isSafeInteger(version) || version < 1
    || !/^\d{1,19}$/.test(generation) || BigInt(generation) > 9223372036854775807n) throw new Error("PIN_SESSION_BINDING_INVALID");
  return createHash("sha256").update(JSON.stringify(["uqp:pin-session:v1", token, credential, version, generation])).digest();
}
