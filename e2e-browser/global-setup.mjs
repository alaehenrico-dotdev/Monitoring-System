// Runs once, before any worker starts (real-stack run only). The seeded admin must choose a new
// password before anything else works, exactly like a first sign-in. That changes the password
// and bumps the account's token version, so it must happen ONCE: done per worker (the old
// beforeAll), the second worker could no longer sign in and the first one's token went stale.
// The resulting session is handed to the workers through an environment variable, which they
// inherit because they are started after this runs.
import { randomUUID } from "node:crypto";

const API = "http://127.0.0.1:4000/api";

export default async function globalSetup() {
  if (process.env.E2E_REAL !== "1") return;

  const username = process.env.E2E_ADMIN_USERNAME ?? "admin";
  const seeded = process.env.E2E_ADMIN_PASSWORD ?? "";
  if (!seeded) throw new Error("set E2E_ADMIN_PASSWORD");

  const post = (path, body, token) =>
    fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });

  const login = await post("/auth/login", { username, password: seeded });
  if (!login.ok) throw new Error(`admin login failed (${login.status}): ${await login.text()}`);
  let { token, user } = await login.json();
  let password = seeded;

  const me = await (await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
  if (me.mustChangePassword) {
    const next = `E2e-Browser-${randomUUID()}`;
    const changed = await post("/auth/change-password", { currentPassword: seeded, newPassword: next }, token);
    if (!changed.ok) throw new Error(`forced password change failed (${changed.status}): ${await changed.text()}`);
    ({ token, user } = await changed.json());
    password = next;
  }

  process.env.E2E_SESSION = JSON.stringify({ token, user, password });
}
