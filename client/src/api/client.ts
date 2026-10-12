const API_BASE = "/api";

type ApiError = { error?: { code?: string; message?: string; detail?: string } };

function notifyAuthInvalid(code?: string) {
  if (typeof window === "undefined") return;
  if (code === "TOKEN_REVOKED" || code === "INVALID_TOKEN") {
    window.dispatchEvent(new CustomEvent("uqp-auth-invalid"));
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  accessToken?: string | null,
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  // Avoid AbortSignal.any/timeout so supported older kiosk browsers use the same deadline.
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, 75_000);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  try {
    const response = await fetch(`${API_BASE}${path}`, { ...options, headers, signal: controller.signal, cache: "no-store" });
    const body = (await response.json().catch(() => ({}))) as T & ApiError;

    if (!response.ok) {
      notifyAuthInvalid(body.error?.code);
      const message = body.error?.message ?? "系統發生錯誤。";
      const detail = body.error?.detail?.trim();
      const error = new Error(detail ? `${message}（${detail}）` : message);
      Object.assign(error, { code: body.error?.code, status: response.status });
      throw error;
    }

    return body;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}


export async function apiDownload(
  path: string,
  body: unknown,
  accessToken?: string | null,
): Promise<{ blob: Blob; filename: string }> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({})) as ApiError;
    notifyAuthInvalid(errorBody.error?.code);
    const error = new Error(errorBody.error?.message ?? "下載失敗。");
    Object.assign(error, { code: errorBody.error?.code, status: response.status });
    throw error;
  }

  const disposition = response.headers.get("content-disposition") ?? "";
  const filenameMatch = disposition.match(/filename="([^"]+)"/i);

  return {
    blob: await response.blob(),
    filename: filenameMatch?.[1] ?? "export.xlsx",
  };
}
