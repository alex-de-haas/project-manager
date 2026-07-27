/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emits `.next/standalone` — server.js plus only the node_modules the server actually
  // requires at runtime. The Docker runner ships that instead of the full production
  // node_modules, which is dominated by build-only weight (the SWC binaries alone are 240 MB).
  output: "standalone",
  // App is served behind the Hosty proxy, which reaches the dev server over
  // 127.0.0.1/localhost. Allow those origins so Next 16 doesn't block HMR.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  experimental: {
    optimizePackageImports: ["date-fns", "lucide-react"],
  },
};

module.exports = nextConfig;
