import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_ORIGIN || 'https://connect.aitathastu.com';

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/room/',
          '/room/*',
          '/admin',
          '/profile',
          '/profile/*',
          '/admin/*',
          '/attendance',
          '/attendance/*',
          '/history',
          '/history/*',
          '/api/',
          '/api/*',
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
