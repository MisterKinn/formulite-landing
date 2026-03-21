import { notFound } from "next/navigation";
import { Navbar } from "../../../../components/Navbar";
import Footer from "../../../../components/Footer";
import NoticeWriteForm from "@/components/NoticeWriteForm";
import { ENABLE_UPDATE_NOTICE } from "@/lib/featureFlags";
import { getNoticeBySlug } from "@/lib/notices";

export default async function NoticeEditPage({
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
            <div className="notice-write-container">
                <div className="notices-header">
                    <h1 className="notices-title">공지 수정</h1>
                    <p className="notices-subtitle">
                        기존 공지 내용을 수정한 뒤 다시 게시할 수 있습니다.
                    </p>
                </div>
                <NoticeWriteForm initialNotice={notice} mode="edit" />
            </div>
            <Footer />
        </div>
    );
}
