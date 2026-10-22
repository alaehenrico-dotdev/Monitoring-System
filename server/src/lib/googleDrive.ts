import type { Readable } from "stream";

/**
 * A small client for the parts of Google's OAuth and Drive REST APIs this app
 * uses. Plain `fetch` rather than the googleapis SDK (tens of MB, for five
 * calls). Nothing here knows about the database or the app's settings: callers
 * pass credentials in, so it is easy to test with a stubbed `fetch`.
 *
 * Scope is `drive.file`: the app can only see and change files and folders it
 * created itself, never the rest of the account's Drive.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://openid.googleapis.com/v1/userinfo";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";

export const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file", "openid", "email"];

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/// Google said the credentials are no longer good (access revoked in the
/// account's security page, or the token expired): the admin must reconnect.
export class DriveAuthError extends Error {}

/// Any other failure talking to Google.
export class DriveApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

async function failure(res: Response, what: string): Promise<never> {
  let detail = "";
  try {
    const body = (await res.json()) as { error?: string | { message?: string }; error_description?: string };
    detail =
      body.error_description ??
      (typeof body.error === "string" ? body.error : body.error?.message) ??
      "";
    if (body.error === "invalid_grant") throw new DriveAuthError("Google no longer accepts this connection - reconnect Google Drive.");
  } catch (err) {
    if (err instanceof DriveAuthError) throw err;
  }
  if (res.status === 401) throw new DriveAuthError("Google rejected the credentials - reconnect Google Drive.");
  throw new DriveApiError(`${what} failed (${res.status})${detail ? `: ${detail}` : ""}`, res.status);
}

export function buildAuthUrl(client: OAuthClient, state: string): string {
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPES.join(" "),
    // offline + consent: the only way Google reliably hands back a refresh
    // token, which is what lets the server upload while nobody is logged in.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /// Seconds the access token stays valid.
  expiresIn: number;
  /// What Google says was actually granted (space separated). The consent screen
  /// lets a person untick individual permissions, so this can be less than asked.
  scope?: string;
}

async function tokenRequest(client: OAuthClient, form: Record<string, string>, what: string): Promise<TokenSet> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, ...form }),
  });
  if (!res.ok) return failure(res, what);
  const body = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresIn: body.expires_in, scope: body.scope };
}

export function exchangeCode(client: OAuthClient, code: string): Promise<TokenSet> {
  return tokenRequest(client, { code, grant_type: "authorization_code", redirect_uri: client.redirectUri }, "Signing in to Google");
}

export function refreshAccessToken(client: OAuthClient, refreshToken: string): Promise<TokenSet> {
  return tokenRequest(client, { refresh_token: refreshToken, grant_type: "refresh_token" }, "Refreshing the Google access");
}

export async function fetchAccountEmail(accessToken: string): Promise<string | null> {
  const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  return ((await res.json()) as { email?: string }).email ?? null;
}

/// Best effort: if Google refuses, the token is unusable anyway.
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  } catch {
    // Nothing useful to do - the local copy is deleted regardless.
  }
}

const auth = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

export async function createFolder(accessToken: string, name: string, parentId?: string): Promise<string> {
  const res = await fetch(`${FILES_URL}?fields=id`, {
    method: "POST",
    headers: { ...auth(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", ...(parentId ? { parents: [parentId] } : {}) }),
  });
  if (!res.ok) return failure(res, "Creating the Drive folder");
  return ((await res.json()) as { id: string }).id;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

export interface DriveFolder {
  id: string;
  name: string;
  trashed: boolean;
}

/// One folder by id, or null when Google no longer knows it (deleted, or it
/// belongs to another account).
export async function getFolder(accessToken: string, folderId: string): Promise<DriveFolder | null> {
  const res = await fetch(`${FILES_URL}/${encodeURIComponent(folderId)}?fields=id,name,trashed`, { headers: auth(accessToken) });
  if (res.status === 404) return null;
  if (!res.ok) return failure(res, "Reading the Drive folder");
  return (await res.json()) as DriveFolder;
}

/// Folders with exactly this name that are not in the trash, oldest first - the
/// system only ever sees folders it made itself (drive.file). Inside `parentId`
/// when given, anywhere it can see otherwise.
export async function findFolders(accessToken: string, name: string, parentId?: string): Promise<DriveFolder[]> {
  // Single quotes and backslashes are the only characters Drive's query syntax
  // treats specially inside a quoted name.
  const quoted = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const clauses = [`name = '${quoted}'`, `mimeType = '${FOLDER_MIME}'`, "trashed = false", ...(parentId ? [`'${parentId}' in parents`] : [])];
  const params = new URLSearchParams({ q: clauses.join(" and "), orderBy: "createdTime", fields: "files(id, name, trashed)", pageSize: "50" });
  const res = await fetch(`${FILES_URL}?${params}`, { headers: auth(accessToken) });
  if (!res.ok) return failure(res, "Looking for the Drive folder");
  return ((await res.json()) as { files: DriveFolder[] }).files;
}

/// Renames a folder in place - its contents and id are untouched.
export async function renameFolder(accessToken: string, folderId: string, name: string): Promise<void> {
  const res = await fetch(`${FILES_URL}/${encodeURIComponent(folderId)}`, {
    method: "PATCH",
    headers: { ...auth(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) await failure(res, "Renaming the Drive folder");
}

export interface UploadInput {
  name: string;
  parentId: string;
  mimeType: string;
  /// Exact byte length - a resumable upload sends it up front.
  size: number;
  body: Buffer | Readable;
}

/// A resumable upload with the whole body in one request: works for a few KB
/// export and a multi-hundred-MB backup alike, and a stream is never buffered
/// whole in memory.
export async function uploadFile(accessToken: string, input: UploadInput): Promise<string> {
  const start = await fetch(`${UPLOAD_URL}?uploadType=resumable&fields=id`, {
    method: "POST",
    headers: {
      ...auth(accessToken),
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": input.mimeType,
      "X-Upload-Content-Length": String(input.size),
    },
    body: JSON.stringify({ name: input.name, parents: [input.parentId] }),
  });
  if (!start.ok) return failure(start, "Starting the Drive upload");
  const location = start.headers.get("location");
  if (!location) throw new DriveApiError("Google did not return an upload address");

  const put = await fetch(location, {
    method: "PUT",
    headers: { "Content-Type": input.mimeType, "Content-Length": String(input.size) },
    body: input.body as unknown as RequestInit["body"],
    // Required by fetch to send a stream as the request body.
    ...({ duplex: "half" } as object),
  });
  if (!put.ok) return failure(put, "Uploading to Drive");
  return ((await put.json()) as { id: string }).id;
}

export interface DriveFile {
  id: string;
  name: string;
  createdTime: string;
  /// Drive's MD5 of the file's bytes (absent for folders), so a file can be
  /// recognised as identical to one about to be uploaded.
  md5Checksum?: string;
}

/// Newest first. Only files this app created are ever visible (drive.file).
export async function listFolder(accessToken: string, folderId: string): Promise<DriveFile[]> {
  const found: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      orderBy: "createdTime desc",
      fields: "nextPageToken, files(id, name, createdTime, md5Checksum)",
      pageSize: "200",
      ...(pageToken ? { pageToken } : {}),
    });
    const res = await fetch(`${FILES_URL}?${params}`, { headers: auth(accessToken) });
    if (!res.ok) return failure(res, "Listing the Drive folder");
    const body = (await res.json()) as { files: DriveFile[]; nextPageToken?: string };
    found.push(...body.files);
    pageToken = body.nextPageToken;
  } while (pageToken);
  return found;
}

/// Moved to the Drive trash (recoverable for 30 days), not deleted outright.
export async function trashFile(accessToken: string, fileId: string): Promise<void> {
  const res = await fetch(`${FILES_URL}/${encodeURIComponent(fileId)}`, {
    method: "PATCH",
    headers: { ...auth(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
  if (!res.ok) await failure(res, "Trashing the old Drive file");
}
