/** Normalize JSON BIGINT strings at the UI boundary, never on the strict API write boundary. */
export function normalizeIds(values: readonly unknown[]): number[] {
  const ids = values.map((value) => {
    if (
      typeof value !== "number" &&
      !(typeof value === "string" && /^[1-9]\d*$/.test(value))
    )
      throw new Error("識別碼格式不正確。");
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0)
      throw new Error("識別碼超出支援範圍。");
    return id;
  });
  return [...new Set(ids)];
}
