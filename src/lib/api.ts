export class ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;

  constructor(status: number, message: string, code = "request_failed", fields?: Record<string, string>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export type Query = Record<string, string | number | boolean | null | undefined>;

function buildPath(path: string, query?: Query) {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value !== "") params.set(key, String(value));
  }
  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal; query?: Query } = {},
): Promise<T> {
  const { method = "GET", body, signal, query } = options;
  let response: Response;
  try {
    response = await fetch(`/api${buildPath(path, query)}`, {
      method,
      credentials: "include",
      signal,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new ApiError(0, "Cannot reach the VendorBridge API. Check that the server is running.", "network_error");
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const err = (payload as { error?: { message?: string; code?: string; fields?: Record<string, string> } })?.error;
    throw new ApiError(
      response.status,
      err?.message || `Request failed with status ${response.status}.`,
      err?.code || "request_failed",
      err?.fields,
    );
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>(path, { query, signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

/**
 * Downloads an authenticated API document (invoice PDF). The session cookie is
 * sent with the request, the server still authorises it, and the filename comes
 * from the response rather than from client-side input.
 */
export async function downloadDocument(path: string) {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { credentials: "include" });
  } catch {
    throw new ApiError(0, "Cannot reach the VendorBridge API. Check that the server is running.", "network_error");
  }

  if (!response.ok) {
    let payload: { error?: { message?: string; code?: string } } | null = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    throw new ApiError(
      response.status,
      payload?.error?.message || `The document could not be downloaded (${response.status}).`,
      payload?.error?.code || "download_failed",
    );
  }

  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] || "document.pdf";
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return filename;
}
