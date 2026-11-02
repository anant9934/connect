import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, DM_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-bricolage',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-dm-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
});

const canonicalUrl = process.env.NEXT_PUBLIC_APP_ORIGIN || 'https://connect-mauve-nine.vercel.app';

export const metadata: Metadata = {
  metadataBase: new URL(canonicalUrl),
  title: {
    default: 'Tathastu Meet | Video Meetings & Real-Time Collaboration',
    template: '%s | Tathastu Meet',
  },
  description:
    'Meet, share ideas, and collaborate with Tathastu Meet. Video meetings for research, projects, mentorship, and teamwork.',
  applicationName: 'Tathastu Meet',
  authors: [{ name: 'AI Tathastu', url: 'https://aitathastu.com' }],
  creator: 'AI Tathastu',
  publisher: 'AI Tathastu',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-48x48.png', sizes: '48x48', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  manifest: '/site.webmanifest',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: canonicalUrl,
    title: 'Tathastu Meet | Video Meetings & Real-Time Collaboration',
    description:
      'Meet, share ideas, and collaborate with Tathastu Meet. Video meetings for research, projects, mentorship, and teamwork.',
    siteName: 'Tathastu Meet',
    images: [
      {
        url: '/android-chrome-512x512.png',
        width: 512,
        height: 512,
        alt: 'Tathastu Meet Logo',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Tathastu Meet | Video Meetings & Real-Time Collaboration',
    description:
      'Meet, share ideas, and collaborate with Tathastu Meet. Video meetings for research, projects, mentorship, and teamwork.',
    images: ['/android-chrome-512x512.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export const viewport: Viewport = {
  themeColor: '#FFB300',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
};

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://aitathastu.com/#organization',
      name: 'AI Tathastu',
      url: 'https://aitathastu.com',
      logo: {
        '@type': 'ImageObject',
        url: 'https://connect-mauve-nine.vercel.app/android-chrome-512x512.png',
        width: 512,
        height: 512,
      },
    },
    {
      '@type': 'WebSite',
      '@id': 'https://connect-mauve-nine.vercel.app/#website',
      url: 'https://connect-mauve-nine.vercel.app',
      name: 'Tathastu Meet',
      description:
        'Video meetings and collaborative spaces for research, projects, mentorship, and everyday teamwork.',
      publisher: {
        '@id': 'https://aitathastu.com/#organization',
      },
    },
    {
      '@type': 'SoftwareApplication',
      '@id': 'https://connect-mauve-nine.vercel.app/#application',
      name: 'Tathastu Meet',
      applicationCategory: 'CommunicationApplication',
      operatingSystem: 'Web, Android, iOS',
      url: 'https://connect-mauve-nine.vercel.app',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
      },
    },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${bricolage.variable} ${dmSans.variable} ${jetbrainsMono.variable}`}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body className="min-h-screen min-h-dvh bg-[#FCFCFA] text-[#17171A] font-sans antialiased selection:bg-[#F1EBFF] selection:text-[#7444E8]">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 z-50 px-4 py-2 bg-[#7444E8] text-white rounded-xl shadow-card"
        >
          Skip to main content
        </a>
        <div className="min-h-screen min-h-dvh flex flex-col">{children}</div>
      </body>
    </html>
  );
}
