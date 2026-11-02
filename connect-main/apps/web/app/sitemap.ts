import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_APP_ORIGIN || 'https://connect-mauve-nine.vercel.app';
  const lastModified = new Date();

  const routes: Array<{
    path: string;
    changeFrequency: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
    priority: number;
  }> = [
    { path: '', changeFrequency: 'weekly', priority: 1.0 },
    { path: '/features', changeFrequency: 'weekly', priority: 0.9 },
    { path: '/security', changeFrequency: 'monthly', priority: 0.9 },
    { path: '/rooms', changeFrequency: 'weekly', priority: 0.8 },
    { path: '/rooms/research', changeFrequency: 'weekly', priority: 0.8 },
    { path: '/rooms/projects', changeFrequency: 'weekly', priority: 0.8 },
    { path: '/rooms/mentorship', changeFrequency: 'weekly', priority: 0.8 },
    { path: '/use-cases/students', changeFrequency: 'weekly', priority: 0.7 },
    { path: '/use-cases/researchers', changeFrequency: 'weekly', priority: 0.7 },
    { path: '/use-cases/teams', changeFrequency: 'weekly', priority: 0.7 },
    { path: '/compare/zoom-alternative', changeFrequency: 'monthly', priority: 0.7 },
    { path: '/compare/google-meet-alternative', changeFrequency: 'monthly', priority: 0.7 },
    { path: '/sign-in', changeFrequency: 'monthly', priority: 0.4 },
    { path: '/sign-up', changeFrequency: 'monthly', priority: 0.4 },
  ];

  return routes.map((route) => ({
    url: `${baseUrl}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
