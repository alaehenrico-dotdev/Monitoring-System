import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const baseUrl = process.env.E2E_API_URL ?? "http://127.0.0.1:4000";
const apiUrl = new URL("/api", baseUrl).toString();
const databaseName = process.env.E2E_DATABASE_NAME ?? "";
const allowRestore = process.env.E2E_ALLOW_DESTRUCTIVE_RESTORE ?? "";

function assertSafeTarget() {
  const parsedBase = new URL(baseUrl);
  const host = parsedBase.hostname;
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(host), "E2E_API_URL must use loopback; production/remote targets are blocked");
  assert.match(databaseName, /(?:^|[_-])(e2e|test)(?:[_-]|$)/i, "E2E_DATABASE_NAME must clearly identify a disposable test database");
  assert.equal(allowRestore, "I_HAVE_A_DISPOSABLE_E2E_DATABASE", "Set the explicit disposable-database confirmation before running restore coverage");
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL must point the E2E API process at its disposable database");
  const configuredDatabaseName = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1));
  assert.equal(configuredDatabaseName, databaseName, "E2E_DATABASE_NAME must exactly match the API process DATABASE_URL database");
}

async function request(path, { method = "GET", token, body, rawBody = false, headers = {} } = {}) {
  return fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined && !rawBody ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: rawBody ? body : JSON.stringify(body) } : {}),
  });
}

function checkHealth() {
  return fetch(new URL("/health", baseUrl));
}

async function login(username, password) {
  const response = await request("/auth/login", { method: "POST", body: { username, password } });
  assert.equal(response.status, 200, `login for ${username}`);
  const result = await response.json();
  assert.ok(result.token, `login token for ${username}`);
  return result;
}

async function expectJson(response, status, label) {
  assert.equal(response.status, status, label);
  return response.json();
}

function logPass(label) {
  // eslint-disable-next-line no-console
  console.log(`PASS ${label}`);
}

function addDays(date, count) {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + count * 86_400_000).toISOString().slice(0, 10);
}

async function main() {
  assertSafeTarget();

  const serverRoot = fileURLToPath(new URL("../server/", import.meta.url));
  const tsxCli = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
  const port = new URL(baseUrl).port || "4000";
  const server = spawn(process.execPath, [tsxCli, "src/server.ts"], {
    cwd: serverRoot,
    env: { ...process.env, PORT: port },
    stdio: "inherit",
  });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (server.exitCode !== null) throw new Error(`E2E API exited before becoming ready (code ${server.exitCode})`);
      try {
        const response = await checkHealth();
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        // The server process is still starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    assert.ok(ready, "E2E API did not become ready within 60 seconds");

  const health = await checkHealth();
  const healthBody = await expectJson(health, 200, "API and database readiness");
  assert.equal(healthBody.database, "ok");
  logPass("API and database readiness");

  const onlineUser = await login(process.env.E2E_ONLINE_USERNAME ?? "online.encoder", process.env.E2E_ONLINE_PASSWORD ?? "");
  const offlineUser = await login(process.env.E2E_OFFLINE_USERNAME ?? "offline.encoder", process.env.E2E_OFFLINE_PASSWORD ?? "");
  const admin = await login(process.env.E2E_ADMIN_USERNAME ?? "admin", process.env.E2E_ADMIN_PASSWORD ?? "");
  assert.equal(onlineUser.user.role, "ONLINE_ENCODER");
  assert.equal(offlineUser.user.role, "OFFLINE_ENCODER");
  assert.equal(admin.user.role, "SUPERVISOR_ADMIN");

  const badLogin = await request("/auth/login", {
    method: "POST",
    body: { username: process.env.E2E_ONLINE_USERNAME ?? "online.encoder", password: "deliberately-wrong-password" },
  });
  assert.equal(badLogin.status, 401, "invalid credentials are rejected");
  logPass("login and role assignment");

  const productsResponse = await request("/products", { token: onlineUser.token });
  const products = await expectJson(productsResponse, 200, "authenticated product list");
  const product = products.find((item) => item.sku === "AFP001") ?? products[0];
  assert.ok(product?.id, "seeded product exists");

  const date = new Date(Date.now() + randomInt(5_000, 20_000) * 86_400_000).toISOString().slice(0, 10);
  const stockPath = `/online-stock/${product.id}?date=${date}&shift=NIGHT`;
  const forbiddenWrite = await request(stockPath, {
    method: "PUT",
    token: offlineUser.token,
    body: { productionIn: 1 },
  });
  assert.equal(forbiddenWrite.status, 403, "offline encoders cannot write online stock");
  logPass("role-based write permissions");

  const save = await request(stockPath, {
    method: "PUT",
    token: onlineUser.token,
    body: { productionIn: 11 },
  });
  const savedRow = await expectJson(save, 200, "online stock save");
  assert.equal(Number(savedRow.remainingStock), Number(savedRow.openingStock) + 11);
  const gridResponse = await request(`/online-stock?date=${date}&shift=NIGHT`, { token: onlineUser.token });
  const grid = await expectJson(gridResponse, 200, "saved online stock is readable");
  const savedGridRow = grid.find((item) => item.product.id === product.id);
  assert.equal(savedGridRow?.isSaved, true);
  assert.equal(Number(savedGridRow?.entry.remainingStock), Number(savedRow.openingStock) + 11);
  logPass("stock save and readback");

  const syncDate = addDays(date, 1);
  const syncStartingGridResponse = await request(`/online-stock?date=${syncDate}&shift=MORNING`, { token: onlineUser.token });
  const syncStartingGrid = await expectJson(syncStartingGridResponse, 200, "offline sync starting balance");
  const syncStartingRow = syncStartingGrid.find((item) => item.product.id === product.id);
  const localId = randomUUID();
  const push = await request("/sync/push", {
    method: "POST",
    token: onlineUser.token,
    body: {
      items: [{
        tableName: "daily_online_stock",
        localId,
        productId: product.id,
        entryDate: syncDate,
        shift: "MORNING",
        baselineUpdatedAt: null,
        delta: { productionIn: 7 },
      }],
    },
  });
  const pushed = await expectJson(push, 200, "offline change push");
  assert.equal(pushed.applied.length, 1);
  const pullResponse = await request("/sync/pull", { token: onlineUser.token });
  const pulled = await expectJson(pullResponse, 200, "offline change pull");
  assert.ok(pulled.onlineStock.some((row) => row.productId === product.id && row.entryDate === syncDate && Number(row.remainingStock) === Number(syncStartingRow?.entry.openingStock) + 7));
  logPass("offline sync push and pull");

  const backupResponse = await request("/backup/download", { token: admin.token });
  assert.equal(backupResponse.status, 200, "admin can download a database backup");
  const backup = new Uint8Array(await backupResponse.arrayBuffer());
  assert.ok(new TextDecoder().decode(backup.slice(0, 32)).startsWith("-- MySQL dump"), "backup has a mysqldump header");

  const sentinelDate = addDays(date, 2);
  const sentinel = await request(`/online-stock/${product.id}?date=${sentinelDate}&shift=NIGHT`, {
    method: "PUT",
    token: onlineUser.token,
    body: { productionIn: 99 },
  });
  assert.equal(sentinel.status, 200, "post-backup sentinel row was created");

  const verify = await request("/data-reset/verify-passcode", {
    method: "POST",
    token: admin.token,
    body: { passcode: process.env.E2E_RESET_PASSCODE ?? "" },
  });
  const verified = await expectJson(verify, 200, "admin restore passcode verification");
  assert.equal(verified.valid, true);
  const restore = await request("/backup/restore", {
    method: "POST",
    token: admin.token,
    body: backup,
    rawBody: true,
    headers: { "Content-Type": "application/sql", "X-Reset-Token": verified.resetToken },
  });
  await expectJson(restore, 200, "database backup restore");

  const originalAfterRestore = await request(`/online-stock?date=${date}&shift=NIGHT`, { token: admin.token });
  const restoredGrid = await expectJson(originalAfterRestore, 200, "restored stock is readable");
  assert.equal(restoredGrid.find((item) => item.product.id === product.id)?.isSaved, true);
  const sentinelAfterRestore = await request(`/online-stock?date=${sentinelDate}&shift=NIGHT`, { token: admin.token });
  const restoredSentinelGrid = await expectJson(sentinelAfterRestore, 200, "post-backup data lookup");
  assert.equal(restoredSentinelGrid.find((item) => item.product.id === product.id)?.isSaved, false);
  logPass("backup, passcode gate, restore, and restored data checks");

  // eslint-disable-next-line no-console
  console.log("All end-to-end checks passed.");
  } finally {
    if (server.exitCode === null) {
      const exited = new Promise((resolve) => server.once("exit", resolve));
      server.kill("SIGTERM");
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
      if (server.exitCode === null) server.kill("SIGKILL");
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
