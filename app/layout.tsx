import type { Metadata } from "next";
import { AuthProvider } from "../context/AuthContext";
import { Analytics } from "@vercel/analytics/next";
import BottomDownloadCTA from "../components/BottomDownloadCTA";

// Global styles
import "./style.css";
import "./mobile.css";

export const metadata: Metadata = {
    title: "NOVA AI - 한글 문서 자동화의 새로운 표준",
    description:
        "당신의 아이디어가 귀찮은 수식 입력으로 인해 끊기지 않도록, UNOVA가 한글 파일을 자동으로 편집하고 관리합니다.",
    icons: {
        icon: "/pabicon789.png",
        shortcut: "/pabicon789.png",
        apple: "/pabicon789.png",
    },
    openGraph: {
        title: "NOVA AI - 한글 문서 자동화의 새로운 표준",
        description:
            "당신의 아이디어가 귀찮은 수식 입력으로 인해 끊기지 않도록, NOVA AI가 한글 파일을 자동으로 편집하고 관리합니다.",
        url: "https://formulite.vercel.app",
        siteName: "NOVA AI",
        images: [
            {
                url: "/nova-logo.png",
                width: 1200,
                height: 630,
                alt: "NOVA AI Banner",
            },
        ],
        locale: "ko_KR",
        type: "website",
    },
    twitter: {
        card: "summary_large_image",
        title: "NOVA AI - 한글 문서 자동화의 새로운 표준",
        description:
            "당신의 아이디어가 귀찮은 수식 입력으로 인해 끊기지 않도록, NOVA AI가 한글 파일을 자동으로 편집하고 관리합니다.",
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
            <head>
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover"
                />
            </head>
            <body className="antialiased" style={{ padding: 0, margin: 0 }}>
                <AuthProvider>
                    <div className="app-shell">{children}</div>
                    <BottomDownloadCTA />
                </AuthProvider>
                <Analytics />
            </body>
        </html>
    );
}
