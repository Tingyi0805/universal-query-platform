import { isIP } from "node:net";

// Literal IPs only: no DNS, ports, zone IDs or proxy-list text in identities/ACLs.
export function normalizeIp(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (raw.includes("%")) return "";
  if (isIP(raw) === 4) return raw;
  if (isIP(raw) !== 6) return "";
  const canonical = new URL(`http://[${raw}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(canonical);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1]!, 16), low = parseInt(mapped[2]!, 16);
  return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
}

// ARR may append REMOTE_PORT. Bare IPv6 is always an address, never guessed as :port.
export function forwardedIp(value: string): string {
  const raw = value.trim(), literal = normalizeIp(raw);
  if (literal) return literal;
  const bracketed = /^\[([^\]]+)\](?::([0-9]{1,5}))?$/.exec(raw);
  const ipv4Port = /^([^:]+):([0-9]{1,5})$/.exec(raw);
  const parts = bracketed ?? ipv4Port;
  if (!parts || (parts[2] !== undefined && (Number(parts[2]) < 1 || Number(parts[2]) > 65535))) return "";
  if (isIP(parts[1]!) !== (bracketed ? 6 : 4)) return "";
  return normalizeIp(parts[1]);
}
