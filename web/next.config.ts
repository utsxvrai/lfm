import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // The series index lives at / now; posts stay under /mistakes/.
      { source: "/mistakes", destination: "/", permanent: true },
      // Flat post URL from before the site grew past one section.
      {
        source: "/001-alter-table-after-column",
        destination: "/mistakes/001-alter-table-after-column",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
