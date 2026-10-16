import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'kastor starter',
  description: 'A Next.js App Router starter with kastor and SQLite.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/monsooncss@0.2.0/dist/monsoon.min.css" />
      </head>
      <body className="bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
