// Standalone output emits `.next/standalone` — server.js plus only the node_modules the server
// actually requires at runtime. The Docker runner ships that instead of the full production
// node_modules, which is dominated by build-only weight (the SWC binaries alone are 240 MB).
//
// Wanted only for the image, so the Dockerfile sets the flag. Off by default keeps `npm run start`
// (`next start`) working without the "next start does not work with output: standalone" warning,
// and keeps the local data directory at ./data — the standalone server chdir's to its own bundle.
const standalone = process.env.NEXT_OUTPUT_STANDALONE === "1";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(standalone ? { output: "standalone" } : {}),
  // App is served behind the Hosty proxy, which reaches the dev server over
  // 127.0.0.1/localhost. Allow those origins so Next 16 doesn't block HMR.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  experimental: {
    optimizePackageImports: ["date-fns", "lucide-react"],
  },
};

module.exports = nextConfig;
