import { z } from "zod";
import { env } from "../config/env";

/// Where a browser's push service lives. A subscription endpoint is a URL the SERVER later sends a request
/// to, so it must be one of the browsers' own push services and nothing else (an arbitrary URL would let
/// an admin make the server contact any host and port). These are the services the major browsers use:
/// Chrome/Edge/Brave/Samsung (FCM), Firefox (Mozilla autopush), Safari (Apple) and Edge on Windows (WNS).
const EXACT_HOSTS = ["fcm.googleapis.com", "android.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"];
const HOST_SUFFIXES = [".push.services.mozilla.com", ".notify.windows.com", ".push.apple.com"];

/// True when `raw` is an https URL on a known push service: no credentials, no custom port, no IP literal.
/// `extraHosts` (the PUSH_ENDPOINT_EXTRA_HOSTS setting) adds exact hosts, or `*.suffix` patterns, for a
/// service not listed above.
export function isAllowedPushEndpoint(raw: string, extraHosts: readonly string[] = env.pushExtraHosts): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  // https on its default port 443 reads as an empty port; anything explicit is refused.
  if (url.port !== "") return false;
  const host = url.hostname.toLowerCase();
  if (!host || host.endsWith(".")) return false;
  if (EXACT_HOSTS.includes(host)) return true;
  if (HOST_SUFFIXES.some((s) => host.endsWith(s) && host.length > s.length)) return true;
  return extraHosts.some((e) => {
    const rule = e.toLowerCase();
    return rule.startsWith("*.") ? host.endsWith(rule.slice(1)) && host.length > rule.length - 1 : host === rule;
  });
}

/// The subscribe route's `endpoint` field: a URL of at most 500 characters on a known push service.
export const pushEndpointSchema = z
  .string()
  .url()
  .max(500)
  .refine((v) => isAllowedPushEndpoint(v), { message: "Not a supported push service address." });
