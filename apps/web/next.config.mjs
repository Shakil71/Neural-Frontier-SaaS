/** @type {import('next').NextConfig} */
const apiOrigin = process.env.NF_API_INTERNAL_URL ?? "http://127.0.0.1:3401";

const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@nf/contracts"],
  // In production Nginx routes /api/* straight to the API; this rewrite serves local dev
  // and any deployment without a proxy in front.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
