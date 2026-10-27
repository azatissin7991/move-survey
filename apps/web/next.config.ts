import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The shared workspace packages ship TypeScript source.
  transpilePackages: ["@move-survey/catalog", "@move-survey/contracts"],
  async headers() {
    return [
      {
        // The capture page needs the camera and microphone, nothing else.
        source: "/s/:path*",
        headers: [{ key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" }],
      },
    ];
  },
};

export default nextConfig;
