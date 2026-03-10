"use client";
import { useRouter } from "next/navigation";
import { Navbar } from "../../../components/Navbar";
import Footer from "../../../components/Footer";

export default function NoticeDetailPage() {
    const router = useRouter();

    return (
        <div className="notices-page">
            <Navbar />
            <div className="notice-detail-container">
                <button
                    className="notice-back-btn"
                    onClick={() => router.push("/notices")}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6" />
                    </svg>
                    공지사항 목록
                </button>

                <article className="notice-detail">
                    <div className="notice-detail-header">
                        <span className="notices-item-category">공지</span>
                        <h1 className="notice-detail-title">
                            2026년 3월 9일 결제 및 업데이트 안내
                        </h1>
                        <time className="notice-detail-date">2026년 3월 9일</time>
                    </div>

                    <div className="notice-detail-body">
                        <img
                            src="/event.png"
                            alt="결제 및 업데이트 한눈에 보기"
                            className="notice-detail-image"
                        />
                        <img
                            src="/event_long.png"
                            alt="상세 업데이트 내용"
                            className="notice-detail-image"
                        />
                    </div>
                </article>
            </div>
            <Footer />
        </div>
    );
}
