/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@guildpass/env",
    "@guildpass/integration-client",
    "@guildpass/webhook-utils",
  ],

  // ── Production optimisations ──────────────────────────────────────
  // Enable compression for production deployments behind a reverse proxy
  compress: true,

  // Note: We do NOT use `output: "standalone"` here because the Dockerfile
  // handles the production build and runtime path setup manually, copying
  // the built .next directory and dependencies directly.
  // Generate ETags for better caching
  generateEtags: true,

  // Power the production health check
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
    ];
  },

  // Exclude health check from the build output (it's a serverless function)
  // and ensure it's not statically generated
  // serverExternalPackages removed
};

export default nextConfig;