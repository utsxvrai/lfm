import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // The series moved under /mistakes when the site grew past one section.
      { source: "/001-alter-table-after-column", destination: "/mistakes/001-alter-table-after-column", permanent: true },
    ];
  },
};

export default nextConfig;
