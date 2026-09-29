/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false, // don't advertise the framework in responses
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
  images: {
    // Only allow product/brand imagery from our own /public/products,
    // /public/brand, /public/mockups directories, or an explicitly
    // allowlisted CDN if you move assets off-origin later — never leave
    // remotePatterns open to arbitrary hosts (SSRF-adjacent risk via
    // next/image's fetch-and-resize proxy, SECURITY.md #28).
    remotePatterns: [],
  },
};

module.exports = nextConfig;
