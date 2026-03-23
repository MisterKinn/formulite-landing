const InstagramIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect
            x="3"
            y="3"
            width="18"
            height="18"
            rx="5"
            ry="5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
        />
        <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" />
    </svg>
);

const YoutubeIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
            d="M21.4 7.2a2.95 2.95 0 0 0-2.08-2.08C17.5 4.6 12 4.6 12 4.6s-5.5 0-7.32.52A2.95 2.95 0 0 0 2.6 7.2 30.94 30.94 0 0 0 2.08 12c0 1.63.17 3.24.52 4.8a2.95 2.95 0 0 0 2.08 2.08C6.5 19.4 12 19.4 12 19.4s5.5 0 7.32-.52a2.95 2.95 0 0 0 2.08-2.08c.35-1.56.52-3.17.52-4.8 0-1.63-.17-3.24-.52-4.8Z"
            fill="currentColor"
        />
        <path d="M10 15.3V8.7L15.8 12 10 15.3Z" fill="#000" />
    </svg>
);

export default function Footer() {
    return (
        <footer className="footer">
            <div className="footer-inner">
                <div className="footer-brand">
                    <img
                        src="/loooogo.png"
                        alt="UNOVA"
                        className="footer-brand-logo"
                    />
                </div>
                <div className="footer-socials" aria-label="소셜 미디어 링크">
                    <a
                        href="https://www.instagram.com/nova_ai_hwp/"
                        target="_blank"
                        rel="noreferrer"
                        className="footer-social-link"
                        aria-label="인스타그램으로 이동"
                    >
                        <InstagramIcon />
                    </a>
                    <a
                        href="https://www.youtube.com/@user_NovaAI"
                        target="_blank"
                        rel="noreferrer"
                        className="footer-social-link"
                        aria-label="유튜브로 이동"
                    >
                        <YoutubeIcon />
                    </a>
                </div>
                <div className="footer-info footer-info--desktop">
                    <p className="footer-line">
                        상호 : 유노바 · 대표 : 장진우 · 개인정보책임관리자 : 장진우 ·
                        사업자등록번호 : 259-40-01233 · 소재지 : 서울특별시 강남구
                        학동로 24길 20, 4층 402호 a411 · TEL : 050-6678-6390
                    </p>
                    <p className="footer-line">
                        이메일 : unova.team.cs@gmail.com · 운영시간 : 평일
                        13:00~21:00, 토요일 13:00~18:00, 일요일 휴무 · 통신판매업
                        신고번호 : 2024-서울강남-06080
                    </p>
                </div>
                <div className="footer-info footer-info--mobile">
                    <p className="footer-line">상호 : 유노바</p>
                    <p className="footer-line">대표 : 장진우</p>
                    <p className="footer-line">개인정보책임관리자 : 장진우</p>
                    <p className="footer-line">사업자등록번호 : 259-40-01233</p>
                    <p className="footer-line">
                        소재지 : 서울특별시 강남구 학동로 24길 20, 4층 402호 a411
                    </p>
                    <p className="footer-line">TEL : 050-6678-6390</p>
                    <p className="footer-line">이메일 : unova.team.cs@gmail.com</p>
                    <p className="footer-line">
                        운영시간 : 평일 13:00~21:00, 토요일 13:00~18:00, 일요일 휴무
                    </p>
                    <p className="footer-line">통신판매업 신고번호 : 2024-서울강남-06080</p>
                </div>
                <div className="footer-copyright">
                    COPYRIGHT 2024. UNOVA. ALL RIGHTS RESERVED.
                </div>
            </div>
        </footer>
    );
}
