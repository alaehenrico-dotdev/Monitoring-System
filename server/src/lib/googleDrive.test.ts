import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthUrl,
  createFolder,
  DriveApiError,
  DriveAuthError,
  exchangeCode,
  listFolder,
  refreshAccessToken,
  trashFile,
  uploadFile,
} from "./googleDrive";

const client = { clientId: "cid.apps.googleusercontent.com", clientSecret: "shh", redirectUri: "http://localhost:8080/api/drive/oauth/callback" };

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("buildAuthUrl", () => {
  const url = new URL(buildAuthUrl(client, "signed-state"));
  const p = url.searchParams;

  it("asks only for the narrow drive.file scope plus the account's email", () => {
    expect(p.get("scope")?.split(" ")).toEqual(["https://www.googleapis.com/auth/drive.file", "openid", "email"]);
    expect(p.get("scope")).not.toMatch(/auth\/drive(\s|$)/);
  });

  it("asks for offline access with a fresh consent so Google returns a refresh token", () => {
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent");
  });

  it("carries the client, redirect and state through", () => {
    expect(p.get("client_id")).toBe(client.clientId);
    expect(p.get("redirect_uri")).toBe(client.redirectUri);
    expect(p.get("state")).toBe("signed-state");
    expect(url.origin).toBe("https://accounts.google.com");
  });
});

describe("token requests", () => {
  it("exchanges a code for tokens", async () => {
    fetchMock.mockResolvedValue(json({ access_token: "at", refresh_token: "rt", expires_in: 3599 }));
    expect(await exchangeCode(client, "the-code")).toEqual({ accessToken: "at", refreshToken: "rt", expiresIn: 3599 });
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("the-code");
    expect(body.get("client_secret")).toBe("shh");
  });

  it("refreshes an access token from the refresh token", async () => {
    fetchMock.mockResolvedValue(json({ access_token: "fresh", expires_in: 3599 }));
    expect((await refreshAccessToken(client, "rt")).accessToken).toBe("fresh");
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).get("grant_type")).toBe("refresh_token");
  });

  it("treats invalid_grant as access that has been revoked, so the admin is told to reconnect", async () => {
    fetchMock.mockResolvedValue(json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400));
    await expect(refreshAccessToken(client, "rt")).rejects.toBeInstanceOf(DriveAuthError);
  });

  it("reports other failures with Google's reason", async () => {
    fetchMock.mockResolvedValue(json({ error: "invalid_client", error_description: "The OAuth client was not found." }, 401));
    await expect(exchangeCode(client, "c")).rejects.toThrow(/OAuth client was not found|reconnect/i);
  });
});

describe("folders and uploads", () => {
  it("creates a folder", async () => {
    fetchMock.mockResolvedValue(json({ id: "folder-1" }));
    expect(await createFolder("at", "Ala Eh Backups")).toBe("folder-1");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: "Ala Eh Backups", mimeType: "application/vnd.google-apps.folder" });
  });

  it("uploads in two steps: open a resumable session, then send the bytes to the address Google returns", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { location: "https://upload.example/session-1" } }))
      .mockResolvedValueOnce(json({ id: "file-9" }));
    const id = await uploadFile("at", { name: "backup.sql.gz", parentId: "folder-1", mimeType: "application/gzip", size: 5, body: Buffer.from("hello") });
    expect(id).toBe("file-9");

    const [startUrl, start] = fetchMock.mock.calls[0];
    expect(String(startUrl)).toContain("uploadType=resumable");
    expect(JSON.parse(start.body)).toEqual({ name: "backup.sql.gz", parents: ["folder-1"] });
    expect(start.headers["X-Upload-Content-Length"]).toBe("5");

    const [putUrl, put] = fetchMock.mock.calls[1];
    expect(putUrl).toBe("https://upload.example/session-1");
    expect(put.method).toBe("PUT");
    expect(put.headers["Content-Length"]).toBe("5");
  });

  it("fails clearly if Google gives no upload address", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await expect(uploadFile("at", { name: "x", parentId: "f", mimeType: "text/csv", size: 1, body: Buffer.from("x") })).rejects.toBeInstanceOf(DriveApiError);
  });

  it("reports a rejected upload with its status", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { location: "https://upload.example/s" } }))
      .mockResolvedValueOnce(json({ error: { message: "Quota exceeded" } }, 403));
    await expect(uploadFile("at", { name: "x", parentId: "f", mimeType: "text/csv", size: 1, body: Buffer.from("x") })).rejects.toThrow(/403.*Quota exceeded/);
  });
});

describe("listFolder and trashFile", () => {
  it("lists a folder across pages, newest first, never including the trash", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ files: [{ id: "a", name: "new", createdTime: "2026-10-22T00:00:00Z" }], nextPageToken: "p2" }))
      .mockResolvedValueOnce(json({ files: [{ id: "b", name: "old", createdTime: "2026-10-01T00:00:00Z" }] }));
    expect((await listFolder("at", "folder-1")).map((f) => f.id)).toEqual(["a", "b"]);
    const firstUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(firstUrl.searchParams.get("q")).toBe("'folder-1' in parents and trashed = false");
    expect(firstUrl.searchParams.get("orderBy")).toBe("createdTime desc");
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get("pageToken")).toBe("p2");
  });

  it("trashes a file rather than deleting it outright", async () => {
    fetchMock.mockResolvedValue(json({}));
    await trashFile("at", "file-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/files/file-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ trashed: true });
  });
});
