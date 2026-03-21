import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title: 'ZenStack GraphQL Next.js Demo',
    description: 'A local playground for the zenstack-graphql adapter.',
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
