import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Study vault | Tathastu Meet',
  description: 'Lecture notes, revision sheets, quizzes and flashcards.',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      'max-video-preview': -1,
      'max-image-preview': 'none',
      'max-snippet': -1,
    },
  },
};

export default function StudyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
