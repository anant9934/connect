/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  redirects: async () => [
    {
      source: '/:path*',
      has: [
        {
          type: 'host',
          value: 'connect-mauve-nine.vercel.app',
        },
      ],
      destination: 'https://connect.aitathastu.com/:path*',
      permanent: true,
    },
  ],
  rewrites: async () => [
    {
      source: '/api/v1/:path*',
      destination: `${process.env.INTERNAL_API_URL || 'http://localhost:8080'}/api/v1/:path*`,
    },
    {
      source: '/health/:path*',
      destination: `${process.env.INTERNAL_API_URL || 'http://localhost:8080'}/health/:path*`,
    },
  ],
  headers: async () => [
    {
      source: '/:path*',
      headers: [
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload',
        },
        {
          key: 'X-Content-Type-Options',
          value: 'nosniff',
        },
        {
          key: 'X-Frame-Options',
          value: 'DENY',
        },
        {
          key: 'X-DNS-Prefetch-Control',
          value: 'on',
        },
        {
          key: 'Referrer-Policy',
          value: 'strict-origin-when-cross-origin',
        },
        {
          key: 'Permissions-Policy',
          value: 'camera=(), microphone=(), display-capture=(), geolocation=(), payment=()',
        },
        {
          key: 'Cross-Origin-Opener-Policy',
          value: 'same-origin',
        },
        {
          key: 'Cross-Origin-Resource-Policy',
          value: 'same-origin',
        },
        {
          key: 'Content-Security-Policy',
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'", // Next.js hydration bootstrap scripts
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com data:",
            "img-src 'self' data: blob: https: http://localhost:8080",
            "connect-src 'self' http://localhost:8080 ws://localhost:8080 http://localhost:7880 ws://localhost:7880 wss://localhost:7880 https: wss:",
            "frame-ancestors 'none'",
            "object-src 'none'",
            "base-uri 'self'",
          ].join('; '),
        },
      ],
    },
    {
      source: '/room/:path*',
      headers: [
        {
          key: 'Permissions-Policy',
          value: 'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=()',
        },
        {
          key: 'X-Robots-Tag',
          value: 'noindex, nofollow, noarchive, nosnippet',
        },
        {
          key: 'Cache-Control',
          value: 'private, no-cache, no-store, max-age=0, must-revalidate',
        },
        {
          key: 'Pragma',
          value: 'no-cache',
        },
      ],
    },
    {
      source: '/admin/:path*',
      headers: [
        {
          key: 'X-Robots-Tag',
          value: 'noindex, nofollow, noarchive, nosnippet',
        },
        {
          key: 'Cache-Control',
          value: 'private, no-cache, no-store, max-age=0, must-revalidate',
        },
        {
          key: 'Pragma',
          value: 'no-cache',
        },
      ],
    },
    {
      source: '/attendance/:path*',
      headers: [
        {
          key: 'X-Robots-Tag',
          value: 'noindex, nofollow, noarchive, nosnippet',
        },
        {
          key: 'Cache-Control',
          value: 'private, no-cache, no-store, max-age=0, must-revalidate',
        },
        {
          key: 'Pragma',
          value: 'no-cache',
        },
      ],
    },
    {
      source: '/profile/:path*',
      headers: [
        {
          key: 'X-Robots-Tag',
          value: 'noindex, nofollow, noarchive, nosnippet',
        },
        {
          key: 'Cache-Control',
          value: 'private, no-cache, no-store, max-age=0, must-revalidate',
        },
        {
          key: 'Pragma',
          value: 'no-cache',
        },
      ],
    },
    {
      source: '/history/:path*',
      headers: [
        {
          key: 'X-Robots-Tag',
          value: 'noindex, nofollow, noarchive, nosnippet',
        },
        {
          key: 'Cache-Control',
          value: 'private, no-cache, no-store, max-age=0, must-revalidate',
        },
        {
          key: 'Pragma',
          value: 'no-cache',
        },
      ],
    },
  ],
};

export default nextConfig;
