import { lookup } from "dns/promises";
import net from "net";

interface SafeFetchOptions {
  allowLoopbackOnly?: boolean;
  maxRedirects?: number;
}

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
    if (options.allowLoopbackOnly) {
      if (!isLoopbackAddress(address)) {
        throw new Error("Endpoint must resolve to a loopback address");
      }
    } else if (isPrivateOrReservedAddress(address)) {
      throw new Error("URL must not resolve to a private or reserved address");
    }
  }

  return url;
};

export const safeServerFetch = async (
  rawUrl: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {}
): Promise<Response> => {
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  let currentUrl = await validateHttpUrlForServerFetch(rawUrl, options);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await fetch(currentUrl.toString(), {
      ...init,
      redirect: "manual",
    });

    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) return response;
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
