/** @type {import('next').NextConfig} */
const nextConfig = {
  // No API keys are exposed to the frontend bundle —
  // only the backend URL is needed, passed via NEXT_PUBLIC_.
  env: {},
  images: {
    domains: [],
  },
};

module.exports = nextConfig;
