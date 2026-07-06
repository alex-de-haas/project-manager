import { describe, expect, it } from "vitest";

import { validateHttpUrlForServerFetch } from "@/lib/safe-fetch";

// These exercise the SSRF policy (M3) deterministically and offline: IP-literal hostnames are
// returned by dns.lookup verbatim without a network query, so each case pins the exact address
// the policy is asked to judge.
describe("validateHttpUrlForServerFetch — SSRF policy", () => {
  it("allows a public IP-literal https URL", async () => {
    const url = await validateHttpUrlForServerFetch("https://8.8.8.8/v1/models");
    expect(url.href).toBe("https://8.8.8.8/v1/models");
  });

  it.each([
    ["loopback 127/8", "http://127.0.0.1/"],
    ["private 10/8", "http://10.0.0.1/"],
    ["private 172.16/12", "http://172.16.5.4/"],
    ["private 192.168/16", "http://192.168.1.1/"],
    ["link-local / cloud metadata", "http://169.254.169.254/latest/meta-data/"],
    ["all-zeros 0/8", "http://0.0.0.0/"],
    ["cgnat 100.64/10", "http://100.64.0.1/"],
  ])("rejects %s by default", async (_label, target) => {
    await expect(validateHttpUrlForServerFetch(target)).rejects.toThrow();
  });

  it("rejects non-http(s) schemes", async () => {
    await expect(validateHttpUrlForServerFetch("ftp://8.8.8.8/")).rejects.toThrow(
      /http or https/
    );
    await expect(validateHttpUrlForServerFetch("file:///etc/passwd")).rejects.toThrow();
  });

  it("rejects embedded credentials", async () => {
    await expect(
      validateHttpUrlForServerFetch("http://user:pass@8.8.8.8/")
    ).rejects.toThrow(/credentials/);
  });

  it("rejects a non-absolute URL", async () => {
    await expect(validateHttpUrlForServerFetch("/relative/path")).rejects.toThrow(
      /absolute/
    );
  });

  describe("with allowPrivateNetwork", () => {
    it("permits RFC1918 addresses", async () => {
      const url = await validateHttpUrlForServerFetch("http://10.1.2.3/", {
        allowPrivateNetwork: true,
      });
      expect(url.hostname).toBe("10.1.2.3");
    });

    it("still rejects reserved / metadata addresses", async () => {
      await expect(
        validateHttpUrlForServerFetch("http://169.254.169.254/", {
          allowPrivateNetwork: true,
        })
      ).rejects.toThrow(/reserved/);
    });
  });

  describe("with allowLoopbackOnly", () => {
    it("permits loopback", async () => {
      const url = await validateHttpUrlForServerFetch("http://127.0.0.1:1234/", {
        allowLoopbackOnly: true,
      });
      expect(url.hostname).toBe("127.0.0.1");
    });

    it("rejects a non-loopback address", async () => {
      await expect(
        validateHttpUrlForServerFetch("http://8.8.8.8/", { allowLoopbackOnly: true })
      ).rejects.toThrow(/loopback/);
    });
  });
});
