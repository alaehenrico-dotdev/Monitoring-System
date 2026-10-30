// "Remember this device": the tick on the login page and the username it keeps. Stored in
// this browser only, never the password. Every access is wrapped because storage can be
// blocked (private windows, strict settings) - the login page must work without it.
const FLAG_KEY = "ala-eh-remember-device";
const USERNAME_KEY = "ala-eh-remembered-username";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the choice simply is not kept */
  }
}

export function isDeviceRemembered(): boolean {
  return read(FLAG_KEY) === "1";
}

export function rememberedUsername(): string {
  return isDeviceRemembered() ? (read(USERNAME_KEY) ?? "") : "";
}

/// Called on every successful password check with the state of the tick.
export function saveDeviceChoice(remember: boolean, username: string) {
  write(FLAG_KEY, remember ? "1" : null);
  write(USERNAME_KEY, remember ? username : null);
}

export function forgetDevice() {
  write(FLAG_KEY, null);
  write(USERNAME_KEY, null);
}
