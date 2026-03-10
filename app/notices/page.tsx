"use client";
import { useRouter } from "next/navigation";
import { Navbar } from "../../components/Navbar";
import Footer from "../../components/Footer";

const notices = [
    {
        id: 1,
        category: "공지",
        title: "2026년 3월 9일 결제 및 업데이트 안내",
        date: "2026-03-09",
        summary: "토스페이먼츠 PG사 변경, UI/UX 업데이트, 채팅 편집모드 등 주요 변경사항을 안내드립니다.",
    },
];

export default function NoticesPage() {
    const router = useRouter();

    return (
        <div className="notices-page">
            <Navbar />
            <div className="notices-container">
                <div className="notices-header">
                    <h1 className="notices-title">공지사항</h1>
                    <p className="notices-subtitle">NOVA AI의 최신 소식을 확인하세요</p>
                </div>
                <div className="notices-list">
                    {notices.map((notice) => (
                        <article
                            key={notice.id}
                            className="notices-item"
                            onClick={() => router.push(`/notices/${notice.id}`)}
                        >
                            <div className="notices-item-left">
                                <span className="notices-item-category">{notice.category}</span>
                                <h2 className="notices-item-title">{notice.title}</h2>
                                <p className="notices-item-summary">{notice.summary}</p>
                            </div>
                            <div className="notices-item-right">
                                <span className="notices-item-date">{notice.date}</span>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="9 18 15 12 9 6" />
                                </svg>
                            </div>
                        </article>
                    ))}
                </div>
            </div>
            <Footer />
        </div>
    );
}
