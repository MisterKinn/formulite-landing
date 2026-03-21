"use client";

const KAKAO_INQUIRY_URL = "https://open.kakao.com/o/sVWlO2fi";

export default function KakaoInquiryButton() {
    return (
        <a
            className="kakao-inquiry-button"
            href={KAKAO_INQUIRY_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="카카오톡 문의하기"
            title="카카오톡 문의하기"
        >
            <span className="kakao-inquiry-button__icon" aria-hidden="true">
                <svg
                    viewBox="0 0 32 32"
                    width="28"
                    height="28"
                    role="img"
                    aria-hidden="true"
                >
                    <path
                        fill="#111111"
                        d="M16 4.5C9.096 4.5 3.5 8.843 3.5 14.2c0 3.4 2.255 6.39 5.665 8.097l-1.16 4.47a.9.9 0 0 0 1.286 1.02l5.168-2.763c.507.059 1.021.089 1.541.089 6.904 0 12.5-4.343 12.5-9.7S22.904 4.5 16 4.5Z"
                    />
                    <text
                        x="16"
                        y="17.2"
                        textAnchor="middle"
                        fontSize="6.8"
                        fontWeight="800"
                        fontFamily="Arial, Helvetica, sans-serif"
                        fill="#f7e34f"
                    >
                        TALK
                    </text>
                </svg>
            </span>
            <span className="kakao-inquiry-button__label">카카오톡 문의</span>
        </a>
    );
}
