import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    // R2 CDN 도메인 허용 — NEXT_PUBLIC_R2_PUBLIC_BASE_URL 호스트와 일치시킬 것
    remotePatterns: [
      { protocol: 'https', hostname: '*.r2.dev' },
      { protocol: 'https', hostname: '*.cloudflarestorage.com' },
    ],
  },
}

export default nextConfig
