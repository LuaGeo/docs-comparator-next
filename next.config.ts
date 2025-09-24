import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        canvas: false,
      };
    }
    return config;
  },
  turbopack: {
    rules: {
      "*.worker.js": {
        loaders: ["worker-loader"],
        as: "*.js",
      },
    },
  },
};

export default nextConfig;
