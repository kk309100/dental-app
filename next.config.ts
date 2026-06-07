import type { NextConfig } from "next";

const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  async headers() {
    return [
      {
        // HTMLページはキャッシュしない（デプロイ後に古いチャンクURLが残らないよう）
        source: "/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
        missing: [
          {
            type: "header",
            key: "content-type",
            value: "(.*)(css|js|image)(.*)",
          },
        ],
      },
    ]
  },
}

export default nextConfig
