import { notFound } from "next/navigation";
import { Navbar } from "../../../components/Navbar";
import Footer from "../../../components/Footer";
import NoticeWriteForm from "@/components/NoticeWriteForm";
import { ENABLE_UPDATE_NOTICE } from "@/lib/featureFlags";

export default function NoticeWritePage() {
    if (!ENABLE_UPDATE_NOTICE) {
        notFound();
    }

    return (
        <div className="notices-page">
            <Navbar />
            <div className="notice-write-container">
                <div className="notices-header">
                    <h1 className="notices-title">공지 작성</h1>
                    <p className="notices-subtitle">
                        관리자 계정으로 새로운 공지 글을 등록할 수 있습니다.
                    </p>
                </div>
                <NoticeWriteForm />
            </div>
            <Footer />
        </div>
    );
}
