import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a self-contained .next/standalone server (only the files a production
  // deploy needs) so the Docker image in Dockerfile doesn't have to ship node_modules.
  output: "standalone",
};

export default nextConfig;
