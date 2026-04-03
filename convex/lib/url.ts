/**
 * SSRF protection: reject URLs that resolve to private/internal networks.
 * Returns true if the URL is safe to fetch server-side.
 */
export function isSafeUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return false;
  }

  const hostname = parsed.hostname;
  const bare = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;

  if (
    bare === "localhost" ||
    bare.startsWith("127.") ||
    bare.startsWith("10.") ||
    bare.startsWith("192.168.") ||
    bare.startsWith("169.254.") ||
    (bare.startsWith("172.") && (() => {
      const second = parseInt(bare.split(".")[1], 10);
      return second >= 16 && second <= 31;
    })()) ||
    bare === "::1" ||
    bare === "0.0.0.0" ||
    bare.startsWith("fc") || bare.startsWith("fd") || // fc00::/7 (ULA)
    bare.startsWith("fe80") || // fe80::/10 (link-local)
    hostname.endsWith(".internal") ||
    bare === "metadata.google.internal"
  ) {
    return false;
  }

  return true;
}
