import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getToken: vi.fn<() => string | null>(),
  getDriveExportConfig: vi.fn(),
  uploadExportCopy: vi.fn(),
}));
vi.mock("../api/http", () => ({ getToken: api.getToken }));
vi.mock("../api/drive", () => ({
  getDriveExportConfig: api.getDriveExportConfig,
  uploadExportCopy: api.uploadExportCopy,
}));

import { copyExportToDrive, MAX_COPY_BYTES, resetDriveCopyConfig } from "./driveCopy";

const file = (text = "a,b\n1,2\n") => new Blob([text]);
/// copyExportToDrive returns at once and works in the background; this lets that
/// background work (a few resolved promises) finish before asserting nothing happened.
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  vi.clearAllMocks();
  resetDriveCopyConfig();
  api.getToken.mockReturnValue("jwt");
  api.getDriveExportConfig.mockResolvedValue({ saveExports: true });
  api.uploadExportCopy.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe("copyExportToDrive", () => {
  it("sends the file when Drive is connected and copies are on", async () => {
    const blob = file();
    copyExportToDrive("total-stocks.csv", blob);
    await settle();
    expect(api.uploadExportCopy).toHaveBeenCalledWith("total-stocks.csv", blob);
  });

  it("returns at once without waiting for the upload, so it can never delay a download", () => {
    api.uploadExportCopy.mockReturnValue(new Promise(() => {}));
    expect(copyExportToDrive("a.csv", file())).toBeUndefined();
  });

  it("sends nothing when the admin has copies switched off or Drive is not connected", async () => {
    api.getDriveExportConfig.mockResolvedValue({ saveExports: false });
    copyExportToDrive("a.csv", file());
    await settle();
    expect(api.uploadExportCopy).not.toHaveBeenCalled();
  });

  it("does not even ask the server when nobody is signed in", async () => {
    api.getToken.mockReturnValue(null);
    copyExportToDrive("a.csv", file());
    await settle();
    expect(api.getDriveExportConfig).not.toHaveBeenCalled();
    expect(api.uploadExportCopy).not.toHaveBeenCalled();
  });

  it("skips empty files and files over the size the server accepts", async () => {
    copyExportToDrive("empty.csv", new Blob([]));
    copyExportToDrive("huge.zip", { size: MAX_COPY_BYTES + 1 } as Blob);
    await settle();
    expect(api.getDriveExportConfig).not.toHaveBeenCalled();
    expect(api.uploadExportCopy).not.toHaveBeenCalled();
  });

  it("asks the server once for a burst of exports", async () => {
    copyExportToDrive("a.csv", file());
    copyExportToDrive("b.csv", file());
    copyExportToDrive("c.pdf", file());
    await vi.waitFor(() => expect(api.uploadExportCopy).toHaveBeenCalledTimes(3));
    expect(api.getDriveExportConfig).toHaveBeenCalledTimes(1);
  });

  it("asks again after a minute, so a change in Settings reaches open browsers", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    copyExportToDrive("a.csv", file());
    await vi.waitFor(() => expect(api.uploadExportCopy).toHaveBeenCalledTimes(1));
    vi.setSystemTime(Date.now() + 61_000);
    api.getDriveExportConfig.mockResolvedValue({ saveExports: false });
    copyExportToDrive("b.csv", file());
    await vi.waitFor(() => expect(api.getDriveExportConfig).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.uploadExportCopy).toHaveBeenCalledTimes(1);
  });

  it("treats an unreachable server as 'no copy' rather than failing the export", async () => {
    api.getDriveExportConfig.mockRejectedValue(new Error("offline"));
    expect(() => copyExportToDrive("a.csv", file())).not.toThrow();
    await settle();
    expect(api.uploadExportCopy).not.toHaveBeenCalled();
  });

  it("swallows a failed upload (logging it) instead of throwing into the export", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    api.uploadExportCopy.mockRejectedValue(new Error("Quota exceeded"));
    expect(() => copyExportToDrive("a.csv", file())).not.toThrow();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(String(warn.mock.calls[0][1])).toMatch(/Quota exceeded/);
    warn.mockRestore();
  });
});
