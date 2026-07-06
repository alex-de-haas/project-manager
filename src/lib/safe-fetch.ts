import dns from "node:dns";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

interface SafeFetchOptions {
  allowLoopbackOnly?: boolean;
  allowPrivateNetwork?: boolean;
  maxRedirects?: number;
}

type UndiciRequestInit = NonNullable<Parameters<typeof undiciFetch>[1]>;

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number
) => void;

const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const parseIpv4 = (address: string): number | null => {
  const parts = address.split(".");
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    value = (value << 8) + octet;
  }
  return value >>> 0;
};

const ipv4InRange = (address: string, base: string, maskBits: number): boolean => {
  const value = parseIpv4(address);
  const baseValue = parseIpv4(base);
  if (value === null || baseValue === null) return false;
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return (value & mask) === (baseValue & mask);
};

const isLoopbackAddress = (address: string): boolean => {
  if (net.isIPv4(address)) return ipv4InRange(address, "127.0.0.0", 8);
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    const mappedAddress = normalized.slice("::ffff:".length);
    return net.isIPv4(mappedAddress) && ipv4InRange(mappedAddress, "127.0.0.0", 8);
  }
  return normalized === "::1" || normalized === "0:0:0:0:0:0:0:1";
};

const isPrivateOrReservedAddress = (address: string): boolean => {
  if (isLoopbackAddress(address)) return true;
  const normalized = address.toLowerCase();

  if (normalized.startsWith("::ffff:")) {
    const mappedAddress = normalized.slice("::ffff:".length);
    return net.isIPv4(mappedAddress) && isPrivateOrReservedAddress(mappedAddress);
  }

  if (net.isIPv4(address)) {
    return (
      ipv4InRange(address, "10.0.0.0", 8) ||
      ipv4InRange(address, "172.16.0.0", 12) ||
      ipv4InRange(address, "192.168.0.0", 16) ||
      ipv4InRange(address, "169.254.0.0", 16) ||
      ipv4InRange(address, "0.0.0.0", 8) ||
      ipv4InRange(address, "100.64.0.0", 10) ||
      ipv4InRange(address, "192.0.0.0", 24) ||
      ipv4InRange(address, "192.0.2.0", 24) ||
      ipv4InRange(address, "198.18.0.0", 15) ||
      ipv4InRange(address, "198.51.100.0", 24) ||
      ipv4InRange(address, "203.0.113.0", 24) ||
      ipv4InRange(address, "224.0.0.0", 4) ||
      ipv4InRange(address, "240.0.0.0", 4)
    );
  }

  return (
    normalized === "::" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("ff")
  );
};

const isPrivateNetworkAddress = (address: string): boolean => {
  if (isLoopbackAddress(address)) return true;
  const normalized = address.toLowerCase();

  if (normalized.startsWith("::ffff:")) {
    const mappedAddress = normalized.slice("::ffff:".length);
    return net.isIPv4(mappedAddress) && isPrivateNetworkAddress(mappedAddress);
  }

  if (net.isIPv4(address)) {
    return (
      ipv4InRange(address, "10.0.0.0", 8) ||
      ipv4InRange(address, "172.16.0.0", 12) ||
      ipv4InRange(address, "192.168.0.0", 16)
    );
  }

  return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd");
};

// Returns a rejection reason for an address under the given policy, or null if it is allowed.
// Shared so the up-front validation and the connect-time lookup apply identical rules.
const getAddressRejection = (
  address: string,
  options: SafeFetchOptions
): string | null => {
  if (options.allowLoopbackOnly) {
    return isLoopbackAddress(address)
      ? null
      : "Endpoint must resolve to a loopback address";
  }

  if (options.allowPrivateNetwork) {
    return isPrivateOrReservedAddress(address) && !isPrivateNetworkAddress(address)
      ? "URL must not resolve to a reserved address"
      : null;
  }

  return isPrivateOrReservedAddress(address)
    ? "URL must not resolve to a private or reserved address"
    : null;
};

// A DNS lookup that resolves the hostname and rejects the connection if any resolved address
// violates the policy — used as the undici connect lookup. Because this same lookup selects the
// socket address, the address we validate is exactly the one connected to: there is no window in
// which the hostname can re-resolve to a private/loopback IP after validation (DNS-rebinding
// TOCTOU). Redirect hops go through the same lookup, so every connection is re-validated.
const createValidatingLookup =
  (options: SafeFetchOptions) =>
  (
    hostname: string,
    lookupOptions: dns.LookupOptions,
    callback: LookupCallback
  ): void => {
    dns.lookup(
      hostname,
      { ...lookupOptions, all: true, verbatim: false } as dns.LookupAllOptions,
      (err, list) => {
        if (err) return callback(err, "");

        if (!list || list.length === 0) {
          return callback(
            new Error("URL host could not be resolved") as NodeJS.ErrnoException,
            ""
          );
        }

        for (const entry of list) {
          const rejection = getAddressRejection(entry.address, options);
          if (rejection) {
            return callback(new Error(rejection) as NodeJS.ErrnoException, "");
          }
        }

        if ((lookupOptions as dns.LookupAllOptions).all) {
          return callback(null, list);
        }

        const [first] = list;
        return callback(null, first.address, first.family);
      }
    );
  };

export const validateHttpUrlForServerFetch = async (
  rawUrl: string,
  options: SafeFetchOptions = {}
): Promise<URL> => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("URL must be a valid absolute URL");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("URL must use http or https");
  }

  if (url.username || url.password) {
    throw new Error("URL credentials are not allowed");
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: false });
  if (addresses.length === 0) {
    throw new Error("URL host could not be resolved");
  }

  for (const { address } of addresses) {
    const rejection = getAddressRejection(address, options);
    if (rejection) {
      throw new Error(rejection);
    }
  }

  return url;
};

// Cache one validating dispatcher per policy. The connect-time lookup makes reuse safe — every
// new connection is re-validated, so a rebinding attempt can't ride a pooled socket — while
// reusing agents avoids leaking sockets/file descriptors: a fresh Agent per request would keep
// keep-alive sockets open and (on the success path) never be closed. Only a handful of option
// combinations exist, so this stays tiny and process-lived, like the global fetch dispatcher.
const dispatcherCache = new Map<string, Agent>();

const getValidatingDispatcher = (options: SafeFetchOptions): Agent => {
  const key = `${options.allowLoopbackOnly ? 1 : 0}:${options.allowPrivateNetwork ? 1 : 0}`;
  let dispatcher = dispatcherCache.get(key);
  if (!dispatcher) {
    dispatcher = new Agent({ connect: { lookup: createValidatingLookup(options) } });
    dispatcherCache.set(key, dispatcher);
  }
  return dispatcher;
};

export const safeServerFetch = async (
  rawUrl: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {}
): Promise<Response> => {
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  // Syntactic + early DNS validation (fast failure before opening a socket).
  let currentUrl = await validateHttpUrlForServerFetch(rawUrl, options);

  // Pin the connection to a connect-time validated address so the SSRF guard cannot be bypassed
  // by DNS rebinding between validation and connection. The (cached) dispatcher's validating
  // lookup re-checks every hop.
  const dispatcher = getValidatingDispatcher(options);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await undiciFetch(currentUrl.toString(), {
      ...(init as unknown as UndiciRequestInit),
      redirect: "manual",
      dispatcher,
    });

    if (!REDIRECT_STATUSES.has(response.status)) {
      return response as unknown as Response;
    }

    const location = response.headers.get("location");
    // Free the redirect response's socket before following the next hop.
    await response.body?.cancel().catch(() => undefined);
    if (!location) return response as unknown as Response;
    if (redirectCount === maxRedirects) {
      throw new Error("Too many redirects");
    }

    currentUrl = await validateHttpUrlForServerFetch(
      new URL(location, currentUrl).toString(),
      options
    );
  }

  throw new Error("Too many redirects");
};
