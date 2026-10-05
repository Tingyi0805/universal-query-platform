const API_BASE = "/api";

type ApiError = { error?: { code?: string; message?: string } };

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  accessToken?: string | null,
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const body = (await response.json().catch(() => ({}))) as T & ApiError;

  if (!response.ok) {
    const error = new Error(body.error?.message ?? "系統發生錯誤。");
    Object.assign(error, { code: body.error?.code, status: response.status });
    throw error;
  }

  return body;
}
