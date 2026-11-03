/** Mirrors the existing server policy range; no new length policy or default on failed reads. */
export function configuredPinLength(value:unknown):number {
  if(typeof value!=="number"||!Number.isInteger(value)||value<4||value>12)throw new Error("PIN 政策無效，禁止提交；請重新載入。");
  return value;
}
