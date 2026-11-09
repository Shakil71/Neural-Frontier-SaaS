/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Baked in at build time so /api/health reports which commit is live.
  env: { RELEASE_SHA: process.env.RELEASE_SHA ?? "dev" },
};

export default nextConfig;
