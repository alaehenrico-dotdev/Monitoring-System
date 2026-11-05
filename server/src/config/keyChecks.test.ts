import { describe, expect, it } from "vitest";
import { keyWarnings, type KeyCheckInput } from "./keyChecks";

const base: KeyCheckInput = {
  nodeEnv: "production",
  googleClientId: "id",
  googleClientSecret: "secret",
  driveTokenKey: "k",
  backupEncryptionKey: Buffer.alloc(32),
};

describe("keyWarnings", () => {
  it("is silent when both keys are set", () => {
    expect(keyWarnings(base)).toEqual([]);
  });

  it("warns that rotating JWT_SECRET would disconnect Drive when DRIVE_TOKEN_KEY is missing", () => {
    const w = keyWarnings({ ...base, driveTokenKey: "" });
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("DRIVE_TOKEN_KEY");
  });

  it("does not mention the Drive key when Drive is not set up at all", () => {
    expect(keyWarnings({ ...base, googleClientId: "", googleClientSecret: "", driveTokenKey: "" })).toEqual([]);
  });

  it("warns that backups are unencrypted without BACKUP_ENCRYPTION_KEY", () => {
    const w = keyWarnings({ ...base, backupEncryptionKey: null });
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("BACKUP_ENCRYPTION_KEY");
  });

  it("says nothing outside production, where a missing key is normal", () => {
    expect(keyWarnings({ ...base, nodeEnv: "development", driveTokenKey: "", backupEncryptionKey: null })).toEqual([]);
  });
});
