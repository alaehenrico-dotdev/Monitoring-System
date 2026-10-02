/// Decodes a JWT's payload WITHOUT verifying its signature - never a trust
/// decision, since the server verifies every real request's token for real
/// on every call regardless. Exists purely so the Tauri desktop build can
/// show a reasonable identity (id/username/name/role) while it can't reach
/// the server to confirm one via GET /auth/me - see AuthContext.tsx's
/// initial session check.
export function decodeJwtPayload<T>(token: string): T | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(""),
    );
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
