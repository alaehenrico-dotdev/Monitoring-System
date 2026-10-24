import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: { backupDir: "", backupOverdueHours: 36 },
  prisma: {
    backupRecord: { findFirst: vi.fn() },
    driveConnection: { findUnique: vi.fn() },
  },
}));
vi.mock("../config/env", () => ({ env: mocks.env }));
vi.mock("../lib/prisma", () => ({ prisma: mocks.prisma }));

import { backupHealth } from "./backupVerify.service";

const NOW = new Date("2026-10-22T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

/// The newest good backup was taken `h` hours ago.
function lastBackup(h: number | null) {
  mocks.prisma.backupRecord.findFirst.mockImplementation(async ({ where }: { where: { status: unknown } }) =>
    where.status === "OK" ? (h === null ? null : { createdAt: hoursAgo(h) }) : null,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.backupDir = "";
  mocks.env.backupOverdueHours = 36;
  mocks.prisma.driveConnection.findUnique.mockResolvedValue(null);
  lastBackup(null);
});

describe("backupHealth - when a backup counts as overdue", () => {
  it("keeps the 36-hour rule for a setup with no Drive weekly backup", async () => {
    lastBackup(30);
    expect((await backupHealth(NOW)).overdue).toBe(false);
    lastBackup(40);
    expect(await backupHealth(NOW)).toMatchObject({ overdue: true, overdueHours: 36 });
  });

  it("stretches to a week and a bit when Drive's weekly backup is the only scheduled one", async () => {
    mocks.prisma.driveConnection.findUnique.mockResolvedValue({ autoBackup: true });
    lastBackup(6 * 24); // 6 days ago: fine for a weekly backup
    expect(await backupHealth(NOW)).toMatchObject({ overdue: false, overdueHours: 9 * 24 });
    lastBackup(10 * 24); // a Sunday missed
    expect((await backupHealth(NOW)).overdue).toBe(true);
  });

  it("still flags a connection that has never taken a backup", async () => {
    mocks.prisma.driveConnection.findUnique.mockResolvedValue({ autoBackup: true });
    expect((await backupHealth(NOW)).overdue).toBe(true);
  });

  it("keeps the configured rule when Drive's automatic backup is switched off", async () => {
    mocks.prisma.driveConnection.findUnique.mockResolvedValue({ autoBackup: false });
    lastBackup(5 * 24);
    expect(await backupHealth(NOW)).toMatchObject({ overdue: true, overdueHours: 36 });
  });

  it("keeps the configured rule when a backup folder with daily scripts is set, whatever Drive does", async () => {
    mocks.env.backupDir = "/var/backups/ala-eh";
    mocks.prisma.driveConnection.findUnique.mockResolvedValue({ autoBackup: true });
    // (the folder does not exist in this test, so it lists nothing; the record decides)
    lastBackup(5 * 24);
    expect(await backupHealth(NOW)).toMatchObject({ overdue: true, overdueHours: 36 });
  });

  it("never narrows a threshold the admin set wider than the weekly allowance", async () => {
    mocks.env.backupOverdueHours = 90 * 24;
    mocks.prisma.driveConnection.findUnique.mockResolvedValue({ autoBackup: true });
    expect((await backupHealth(NOW)).overdueHours).toBe(90 * 24);
  });
});
