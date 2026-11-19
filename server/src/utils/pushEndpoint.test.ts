import { describe, expect, it } from "vitest";
import { isAllowedPushEndpoint, pushEndpointSchema } from "./pushEndpoint";

const ok = (u: string, extra: string[] = []) => isAllowedPushEndpoint(u, extra);

describe("isAllowedPushEndpoint", () => {
  it("accepts the push services the major browsers use", () => {
    for (const u of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com/wp/abc",
      "https://android.googleapis.com/gcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://autopush.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/QGx0abc",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
      "https://par02p.notify.windows.com/w/?token=abc",
    ]) expect(ok(u), u).toBe(true);
  });

  it("refuses internal, loopback, metadata and arbitrary hosts", () => {
    for (const u of [
      "https://127.0.0.1/x",
      "https://localhost/x",
      "https://[::1]/x",
      "https://169.254.169.254/latest/meta-data",
      "https://10.0.0.5/x",
      "https://db:3306/x",
      "https://example.com/x",
      "https://evil.test/fcm.googleapis.com",
    ]) expect(ok(u), u).toBe(false);
  });

  it("refuses look-alike hosts that merely contain or end like a real one", () => {
    for (const u of [
      "https://fcm.googleapis.com.evil.test/x",
      "https://evilfcm.googleapis.com/x",
      "https://notify.windows.com/x",
      "https://xnotify.windows.com/x",
      "https://push.services.mozilla.com.evil.test/x",
      "https://evil.test@fcm.googleapis.com.evil.test/x",
    ]) expect(ok(u), u).toBe(false);
  });

  it("refuses anything but plain https on the default port with no credentials", () => {
    for (const u of [
      "http://fcm.googleapis.com/x",
      "ftp://fcm.googleapis.com/x",
      "https://fcm.googleapis.com:8443/x",
      "https://user:pw@fcm.googleapis.com/x",
      "https://user@fcm.googleapis.com/x",
      "javascript:alert(1)",
      "not a url",
      "",
    ]) expect(ok(u), u).toBe(false);
    expect(ok("https://fcm.googleapis.com:443/x")).toBe(true);
  });

  it("honours the extra-hosts setting, exact or wildcard, and nothing wider", () => {
    expect(ok("https://push.example.com/x", ["push.example.com"])).toBe(true);
    expect(ok("https://a.push.example.net/x", ["*.push.example.net"])).toBe(true);
    expect(ok("https://push.example.net/x", ["*.push.example.net"])).toBe(false);
    expect(ok("https://evil.push.example.com/x", ["push.example.com"])).toBe(false);
  });
});

describe("pushEndpointSchema", () => {
  it("applies the allowlist and the length limit", () => {
    expect(pushEndpointSchema.safeParse("https://fcm.googleapis.com/fcm/send/abc").success).toBe(true);
    expect(pushEndpointSchema.safeParse("https://127.0.0.1/x").success).toBe(false);
    expect(pushEndpointSchema.safeParse("https://fcm.googleapis.com/" + "a".repeat(500)).success).toBe(false);
  });
});
