import Link from "next/link";
import { notFound } from "next/navigation";
import { Navbar } from "../../components/Navbar";
import Footer from "../../components/Footer";
import NoticesAdminActions from "@/components/NoticesAdminActions";
import { ENABLE_UPDATE_NOTICE } from "@/lib/featureFlags";
import { formatNoticeDate, listNotices } from "@/lib/notices";

export default async function NoticesPage() {
    if (!ENABLE_UPDATE_NOTICE) {
        notFound();
    }

    const notices = await listNotices();

    return (
        <div className="notices-page">
            <Navbar />
            <div className="notices-container">
                <div className="notices-header notices-header-row">
                    <div>
                        <h1 className="notices-title">공지사항</h1>
                        <p className="notices-subtitle">NOVA AI의 최신 소식을 확인하세요</p>
                    </div>
                    <NoticesAdminActions />
                </div>
                <div className="notices-list">
                    {notices.map((notice) => (
                        <Link
                            key={notice.slug}
                            href={`/notices/${notice.slug}`}
                            className="notices-item"
                        >
                            <div className="notices-item-left">
                                <span className="notices-item-category">{notice.category}</span>
                                <h2 className="notices-item-title">{notice.title}</h2>
                                <p className="notices-item-summary">{notice.summary}</p>
                            </div>
                            <div className="notices-item-right">
                                <span className="notices-item-date">
                                    {formatNoticeDate(notice.publishedAt)}
                                </span>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="9 18 15 12 9 6" />
                                </svg>
                            </div>
                        </Link>
                    ))}
                </div>
            </div>
            <Footer />
        </div>
    );
}
