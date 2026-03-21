"use client";

import { usePathname } from "next/navigation";

const HIDDEN_PATHS = ["/download"];

export default function BottomDownloadCTA() {
    const pathname = usePathname();

    if (HIDDEN_PATHS.includes(pathname)) {
        return null;
    }

    return (
        <div className="bottom-download-cta">
            <div className="bottom-download-cta__inner">
                <a href="/api/download/windows" className="bottom-download-cta__button">
                    <svg
                        className="bottom-download-cta__icon"
                        width="22"
                        height="22"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden="true"
                    >
                        <path d="M2 4.05L10.5 2.9v8.2H2V4.05ZM11.8 2.72L22 1.3v9.8H11.8V2.72ZM2 12.2h8.5v8.22L2 19.27V12.2ZM11.8 12.2H22v10.5l-10.2-1.42V12.2Z" />
                    </svg>
                    <span>Windows용 다운로드</span>
                </a>
            </div>
        </div>
    );
}
