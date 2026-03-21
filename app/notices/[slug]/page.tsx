import Link from "next/link";
import { notFound } from "next/navigation";
import { Navbar } from "../../../components/Navbar";
import Footer from "../../../components/Footer";
import NoticeDetailAdminActions from "@/components/NoticeDetailAdminActions";
import { ENABLE_UPDATE_NOTICE } from "@/lib/featureFlags";
import { formatNoticeDate, getNoticeBySlug } from "@/lib/notices";

export default async function NoticeDetailPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    if (!ENABLE_UPDATE_NOTICE) {
        notFound();
    }

    const { slug } = await params;
    const notice = await getNoticeBySlug(slug);

    if (!notice) {
        notFound();
    }

    return (
        <div className="notices-page">
            <Navbar />
            <div className="notice-detail-container">
                <Link href="/notices" className="notice-back-btn">
                    <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <polyline points="15 18 9 12 15 6" />
                    </svg>
                    공지사항 목록
                </Link>

                <article className="notice-detail">
                    <div className="notice-detail-header">
                        <NoticeDetailAdminActions slug={notice.slug} />
                        <span className="notices-item-category">{notice.category}</span>
                        <h1 className="notice-detail-title">{notice.title}</h1>
                        <time className="notice-detail-date">
                            {formatNoticeDate(notice.publishedAt)}
                        </time>
                        <p className="notice-detail-summary">{notice.summary}</p>
                    </div>

                    <div className="notice-detail-body notice-detail-body-copy">
                        {notice.content.split(/\n{2,}/).map((paragraph, index) => (
                            <p key={`${notice.slug}-${index}`}>{paragraph}</p>
                        ))}
                    </div>
                </article>
            </div>
            <Footer />
        </div>
    );
}
