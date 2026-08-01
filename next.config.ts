import type { NextConfig } from "next";
import path from "path";

const projectRoot = path.join(__dirname);

const nextConfig: NextConfig = {
  // Parent ~/package-lock.json made Turbopack use ~ as root and miss
  // project-local packages like @medplum/react-hooks.
  turbopack: {
    root: projectRoot,
  },
  outputFileTracingRoot: projectRoot,
};

export default nextConfig;
