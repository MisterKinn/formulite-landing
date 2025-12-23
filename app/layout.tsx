import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "../context/AuthContext";

const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});

const geistMono = Geist_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
});

export const metadata: Metadata = {
    title: "Nova AI - 한글 문서 자동화의 새로운 표준",
    description:
        "당신의 아이디어가 귀찮은 수식 입력으로 인해 끊기지 않도록,Nova AI가 한글 파일을 자동으로 편집하고 관리합니다.",
    icons: {
        icon: "/nova.png",
    },
    openGraph: {
        title: "Nova AI - 한글 문서 자동화의 새로운 표준",
        description:
            "당신의 아이디어가 귀찮은 수식 입력으로 인해 끊기지 않도록, Nova AI가 한글 파일을 자동으로 편집하고 관리합니다.",
        url: "https://formulite.vercel.app",
        siteName: "Nova AI",
        images: [
            {
                url: "/nova-banner.png",
                width: 1200,
                height: 630,
                alt: "Nova AI Banner",
            },
        ],
        locale: "ko_KR",
        type: "website",
    },
    twitter: {
        card: "summary_large_image",
        title: "Nova AI - 한글 문서 자동화의 새로운 표준",
        description:
            "당신의 아이디어가 귀찮은 수식 입력으로 인해 끊기지 않도록, Nova AI가 한글 파일을 자동으로 편집하고 관리합니다.",
        images: ["/nova-logo.png"],
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="ko">
            <body
                className={`${geistSans.variable} ${geistMono.variable} antialiased`}
            >
                <AuthProvider>{children}</AuthProvider>
            </body>
        </html>
    );
}
