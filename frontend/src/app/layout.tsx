import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "ReportAI",
  description: "AI-powered academic report generation platform",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  const theme = localStorage.getItem('reportai_theme') || 'light';
                  const accent = localStorage.getItem('reportai_accent') || 'ocean';
                  if (theme === 'dark') document.documentElement.classList.add('dark');
                  if (accent === 'emerald') document.documentElement.classList.add('theme-emerald');
                  if (accent === 'royal') document.documentElement.classList.add('theme-royal');
                } catch (e) {}
              })()
            `,
          }}
        />
      </head>
      <body className="font-sans antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
