import { isIP } from "node:net";

export function normalizeClientIp(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (raw.startsWith("::ffff:")) return raw.slice(7);
  return raw;
}

function ipv4ToInt(ip: string): number | null {
  if (isIP(ip) !== 4) return null;
  const parts = ip.split(".").map(Number);
  return (
    ((parts[0] << 24) >>> 0) +
    ((parts[1] << 16) >>> 0) +
    ((parts[2] << 8) >>> 0) +
    (parts[3] >>> 0)
  ) >>> 0;
}

export function isValidIpOrCidr(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (isIP(trimmed)) return true;

  const [network, prefixText, extra] = trimmed.split("/");
  if (extra !== undefined || isIP(network) !== 4) return false;

  const prefix = Number(prefixText);
  return Number.isInteger(prefix) && prefix >= 0 && prefix <= 32;
}

export function matchesIpRestriction(
  clientIp: string,
  allowedIp: string | null,
  allowedCidr: string | null,
): boolean {
  const normalized = normalizeClientIp(clientIp);

  if (allowedIp && normalizeClientIp(allowedIp) === normalized) return true;
  if (!allowedCidr) return false;

  const [network, prefixText] = allowedCidr.split("/");
  const prefix = Number(prefixText);
  const client = ipv4ToInt(normalized);
  const base = ipv4ToInt(network);

  if (client == null || base == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }

  if (prefix === 0) return true;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (client & mask) === (base & mask);
}
