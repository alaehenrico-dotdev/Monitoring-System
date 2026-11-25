import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => ({ prisma: {} }));
vi.mock("../repositories/userRepository", () => ({
  userRepository: {
    findByUsername: vi.fn(),
    findById: vi.fn(),
    findByEmail: vi.fn(),
    setResetCode: vi.fn(),
    issueResetCodeIfDue: vi.fn(),
    setPendingEmail: vi.fn(),
    findByEmailVerifyHash: vi.fn(),
    confirmPendingEmail: vi.fn(),
  },
}));
vi.mock("./changeLog.service", () => ({ logSystemEvent: vi.fn() }));
const assertAdminPassword = vi.hoisted(() => vi.fn());
vi.mock("./adminPassword.service", () => ({ assertAdminPassword }));
const sendMail = vi.hoisted(() => vi.fn());
const mailConfigured = vi.hoisted(() => vi.fn());
vi.mock("../lib/mailer", () => ({ sendMail, mailConfigured }));

import { userRepository } from "../repositories/userRepository";
import { hashResetCode, RESET_CODE_TTL_MS } from "../utils/resetCode";
import { confirmEmail, notifyPasswordReset, requestEmailChange, requestResetEmail } from "./recoveryEmail.service";

function admin(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    username: "admin",
    role: "SUPERVISOR_ADMIN",
    isActive: true,
    email: "admin@example.com",
    emailVerifiedAt: new Date(),
    resetCodeExpiresAt: null,
    ...overrides,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  mailConfigured.mockReturnValue(true);
  sendMail.mockResolvedValue(undefined);
  assertAdminPassword.mockResolvedValue(undefined);
  vi.mocked(userRepository.findByEmail).mockResolvedValue(null);
  vi.mocked(userRepository.issueResetCodeIfDue).mockResolvedValue(true);
});

describe("requestResetEmail", () => {
  it("emails a one-time code to a verified, active administrator - and only its hash is stored", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(admin() as never);
    await requestResetEmail("admin");
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe("admin@example.com");
    const code = /code: ([A-Z2-9]{5}-[A-Z2-9]{5})/.exec(mail.text)?.[1];
    expect(code).toBeTruthy();
    const [id, hash, expiresAt] = vi.mocked(userRepository.issueResetCodeIfDue).mock.calls[0];
    expect(id).toBe(1);
    expect(hash).toBe(hashResetCode(code!));
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + RESET_CODE_TTL_MS - 5000);
  });

  it.each([
    ["an encoder", { role: "ENCODER" }],
    ["an auditor", { role: "AUDITOR" }],
    ["a deactivated admin", { isActive: false }],
    ["an admin with no email", { email: null }],
    ["an admin whose email is not verified", { emailVerifiedAt: null }],
  ])("sends nothing for %s, and does not throw", async (_label, overrides) => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(admin(overrides) as never);
    await expect(requestResetEmail("admin")).resolves.toBeUndefined();
    expect(sendMail).not.toHaveBeenCalled();
    expect(userRepository.issueResetCodeIfDue).not.toHaveBeenCalled();
  });

  it("sends nothing for an unknown username, and does not throw", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(null);
    await expect(requestResetEmail("nobody")).resolves.toBeUndefined();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("does nothing when mail is not configured or the username is junk", async () => {
    mailConfigured.mockReturnValue(false);
    await requestResetEmail("admin");
    mailConfigured.mockReturnValue(true);
    await requestResetEmail(undefined);
    await requestResetEmail("x".repeat(100));
    expect(userRepository.findByUsername).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("sends at most one mail a minute per account", async () => {
    const issuedSecondsAgo = new Date(Date.now() - 10_000 + RESET_CODE_TTL_MS);
    vi.mocked(userRepository.findByUsername).mockResolvedValue(admin({ resetCodeExpiresAt: issuedSecondsAgo }) as never);
    await requestResetEmail("admin");
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("sends nothing when another simultaneous request already issued the code", async () => {
    vi.mocked(userRepository.findByUsername).mockResolvedValue(admin() as never);
    vi.mocked(userRepository.issueResetCodeIfDue).mockResolvedValue(false);
    await requestResetEmail("admin");
    await flush();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("never lets a mail failure change the outcome", async () => {
    sendMail.mockRejectedValue(new Error("smtp down"));
    vi.mocked(userRepository.findByUsername).mockResolvedValue(admin() as never);
    await expect(requestResetEmail("admin")).resolves.toBeUndefined();
    await flush();
  });
});

describe("notifyPasswordReset", () => {
  it("tells the verified address, and nobody else", async () => {
    notifyPasswordReset({ username: "admin", email: "admin@example.com", emailVerifiedAt: new Date() }, "1.2.3.4");
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "admin@example.com" }));
    sendMail.mockClear();
    notifyPasswordReset({ username: "admin", email: "admin@example.com", emailVerifiedAt: null });
    notifyPasswordReset({ username: "admin", email: null, emailVerifiedAt: null });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("never throws when the mail fails", async () => {
    sendMail.mockRejectedValue(new Error("smtp down"));
    expect(() => notifyPasswordReset({ username: "admin", email: "a@example.com", emailVerifiedAt: new Date() })).not.toThrow();
    await flush();
  });
});

describe("requestEmailChange", () => {
  it("needs the current password and changes nothing without it", async () => {
    assertAdminPassword.mockRejectedValue(Object.assign(new Error("Incorrect password"), { status: 403 }));
    await expect(requestEmailChange(1, "new@example.com", "wrong")).rejects.toMatchObject({ status: 403 });
    expect(userRepository.setPendingEmail).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("refuses anyone who is not an administrator", async () => {
    vi.mocked(userRepository.findById).mockResolvedValue(admin({ role: "ENCODER" }) as never);
    await expect(requestEmailChange(1, "new@example.com", "pw")).rejects.toMatchObject({ status: 403 });
    expect(userRepository.setPendingEmail).not.toHaveBeenCalled();
  });

  it("refuses a malformed address and one another account already uses", async () => {
    vi.mocked(userRepository.findById).mockResolvedValue(admin() as never);
    await expect(requestEmailChange(1, "not-an-email", "pw")).rejects.toMatchObject({ status: 400 });
    vi.mocked(userRepository.findByEmail).mockResolvedValue({ id: 2 } as never);
    await expect(requestEmailChange(1, "taken@example.com", "pw")).rejects.toMatchObject({ status: 409 });
    expect(userRepository.setPendingEmail).not.toHaveBeenCalled();
  });

  it("parks the new address and mails the link to the NEW address, storing only the token hash", async () => {
    vi.mocked(userRepository.findById).mockResolvedValue(admin() as never);
    await requestEmailChange(1, "  New@Example.com ", "pw");
    const [id, pending, hash] = vi.mocked(userRepository.setPendingEmail).mock.calls[0];
    expect(id).toBe(1);
    expect(pending).toBe("new@example.com");
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe("new@example.com");
    const token = /token=([^\s]+)/.exec(mail.text)?.[1];
    expect(hash).toBe(createHash("sha256").update(decodeURIComponent(token!)).digest("hex"));
  });

  it("warns the CURRENT address, with the new one masked", async () => {
    vi.mocked(userRepository.findById).mockResolvedValue(admin() as never);
    await requestEmailChange(1, "new@example.com", "pw");
    const warning = sendMail.mock.calls.map((c) => c[0]).find((m) => m.to === "admin@example.com");
    expect(warning).toBeTruthy();
    expect(warning.text).toContain("n***@example.com");
    expect(warning.text).not.toContain("new@example.com");
  });
});

describe("confirmEmail", () => {
  const TOKEN = "t".repeat(43);
  const pendingAdmin = (overrides: Record<string, unknown> = {}) =>
    admin({ email: "old@example.com", pendingEmail: "new@example.com", emailVerifyExpiresAt: new Date(Date.now() + 60_000), ...overrides });

  it("makes the pending address the recovery email and tells the old address", async () => {
    vi.mocked(userRepository.findByEmailVerifyHash).mockResolvedValue(pendingAdmin() as never);
    vi.mocked(userRepository.confirmPendingEmail).mockResolvedValue(true);
    await confirmEmail(TOKEN);
    expect(userRepository.confirmPendingEmail).toHaveBeenCalledWith(1, "new@example.com", createHash("sha256").update(TOKEN).digest("hex"), expect.any(Date));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "old@example.com" }));
  });

  it("rejects an unknown, expired or already-spent link", async () => {
    vi.mocked(userRepository.findByEmailVerifyHash).mockResolvedValue(null);
    await expect(confirmEmail(TOKEN)).rejects.toMatchObject({ status: 400 });
    vi.mocked(userRepository.findByEmailVerifyHash).mockResolvedValue(pendingAdmin({ emailVerifyExpiresAt: new Date(Date.now() - 1000) }) as never);
    await expect(confirmEmail(TOKEN)).rejects.toMatchObject({ status: 400 });
    vi.mocked(userRepository.findByEmailVerifyHash).mockResolvedValue(pendingAdmin() as never);
    vi.mocked(userRepository.confirmPendingEmail).mockResolvedValue(false);
    await expect(confirmEmail(TOKEN)).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a link whose owner was deactivated or demoted", async () => {
    vi.mocked(userRepository.findByEmailVerifyHash).mockResolvedValue(
      admin({ pendingEmail: "new@example.com", emailVerifyExpiresAt: new Date(Date.now() + 60_000), isActive: false }) as never,
    );
    await expect(confirmEmail(TOKEN)).rejects.toMatchObject({ status: 400 });
    vi.mocked(userRepository.findByEmailVerifyHash).mockResolvedValue(
      admin({ pendingEmail: "new@example.com", emailVerifyExpiresAt: new Date(Date.now() + 60_000), role: "ENCODER" }) as never,
    );
    await expect(confirmEmail(TOKEN)).rejects.toMatchObject({ status: 400 });
    expect(userRepository.confirmPendingEmail).not.toHaveBeenCalled();
  });

  it("rejects a missing or oversized token without looking anything up", async () => {
    await expect(confirmEmail(undefined)).rejects.toMatchObject({ status: 400 });
    await expect(confirmEmail("x")).rejects.toMatchObject({ status: 400 });
    await expect(confirmEmail("x".repeat(500))).rejects.toMatchObject({ status: 400 });
    expect(userRepository.findByEmailVerifyHash).not.toHaveBeenCalled();
  });
});
