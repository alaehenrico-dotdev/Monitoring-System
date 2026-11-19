import { prisma } from "../lib/prisma";

/// Drops every push device a person registered. Called when their access changes (password changed or reset,
/// signed out everywhere, deactivated), so a lost or revoked device stops receiving alerts straight away and a
/// later reactivation does not silently bring old devices back. A device the person is still using registers
/// itself again the next time the app opens. Never throws: a failed cleanup must not undo the access change.
export async function removeAllPushSubscriptions(userId: number): Promise<void> {
  try {
    await prisma.pushSubscription.deleteMany({ where: { userId } });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "push-cleanup-failed", message: err instanceof Error ? err.message : String(err) }));
  }
}
