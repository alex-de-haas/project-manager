/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // App is served behind the Hosty proxy, which reaches the dev server over
  // 127.0.0.1/localhost. Allow those origins so Next 16 doesn't block HMR.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  experimental: {
    optimizePackageImports: ["date-fns", "lucide-react"],
  },
};

module.exports = nextConfig;
