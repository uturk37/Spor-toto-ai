"use client";

const KEY = "spor_toto_admin_token";

export function getToken(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setToken(v: string) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* özel pencere */
  }
}

export async function adminFetch(url: string, init: RequestInit & { json?: unknown } = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", "x-admin-token": getToken(), ...(init.headers ?? {}) },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data;
}
