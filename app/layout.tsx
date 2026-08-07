import type { Metadata } from "next";
import { headers } from "next/headers";
import "@livekit/components-styles";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host?.startsWith("localhost") ? "http" : "https");
  const origin = host ? `${protocol}://${host}` : "http://localhost:3000";
  const title = "SayToSee — лёгкие видеовстречи до 10 человек";
  const description =
    "Создайте защищённую видеовстречу и подключите до 10 участников по короткому ключу.";

  return {
    title,
    description,
    icons: { icon: "/saytosee-mark.png" },
    openGraph: {
      title,
      description,
      type: "website",
      locale: "ru_RU",
      images: [{ url: `${origin}/og.png`, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
