import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DubCast — AI Video Dubbing',
  description: 'Dub any video into any language using AI. Zero cost with your own API keys.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
