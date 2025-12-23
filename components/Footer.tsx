"use client";

export default function Footer() {
    return (
        <footer className="footer">
            <div className="footer-inner">
                <div className="footer-content">
                    {/* Brand & Slogan */}
                    <div className="footer-section-main">
                        <a
                            href="/"
                            title="NOVA AI"
                            className="footer-brand"
                        >
                            <img
                                src="/nova-logo.png"
                                alt="Nova AI logo"
                                style={{
                                    width: 100,
                                    height: 50,
                                    objectFit: "contain",
                                    borderRadius: "0.5rem",
                                }}
                            />
                        </a>
                        <p className="footer-description">
                            당신의 아이디어가 귀찮은 수식 입력으로 인해 끊기지
                            않도록,
                            <br />
                            Nova AI가 한글 파일을 자동으로 편집하고 관리합니다.
                        </p>
                    </div>

                    {/* Links Grid */}
                    <div className="footer-sections">
                        {/* 서비스 */}
                        <div className="footer-column">
                            <div className="footer-section-title">서비스</div>
                            <ul className="footer-links">
                                <li>
                                    <a href="/download" className="footer-link">
                                        다운로드
                                    </a>
                                </li>
                                <li>
                                    <a href="/pricing" className="footer-link">
                                        요금제
                                    </a>
                                </li>
                                <li>
                                    <a href="/profile" className="footer-link">
                                        내 프로필
                                    </a>
                                </li>
                            </ul>
                        </div>

                        {/* 약관 및 정책 */}
                        <div className="footer-column">
                            <div className="footer-section-title">
                                약관 및 정책
                            </div>
                            <ul className="footer-links">
                                <li>
                                    <a href="/terms" className="footer-link">
                                        이용약관
                                    </a>
                                </li>
                                <li>
                                    <a href="/policy" className="footer-link">
                                        개인정보 처리방침
                                    </a>
                                </li>
                            </ul>
                        </div>

                        {/* 문의 */}
                        <div className="footer-column">
                            <div className="footer-section-title">문의</div>
                            <ul className="footer-links">
                                <li>
                                    <a
                                        href="mailto:unova.team.cs@gmail.com"
                                        title="이메일로 문의하기"
                                        className="footer-link"
                                    >
                                        이메일 문의
                                    </a>
                                </li>
                                <li>
                                    <a
                                        href="https://www.instagram.com/nova_ai_official/"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        title="노바AI 인스타그램 바로가기"
                                        className="footer-link"
                                    >
                                        인스타그램
                                    </a>
                                </li>
                                <li>
                                    <a
                                        href="#"
                                        title="카카오톡 문의 바로가기"
                                        className="footer-link"
                                    >
                                        카카오톡 문의
                                    </a>
                                </li>
                            </ul>
                        </div>

                        {/* 소셜 */}
                        <div className="footer-column">
                            <div className="footer-section-title">소셜</div>
                            <ul className="footer-links">
                                <li>
                                    <a
                                        href="https://www.instagram.com/nova_ai_official/"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="footer-link"
                                    >
                                        Instagram
                                    </a>
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>

                {/* Footer Bottom */}
                <div className="footer-bottom">
                    <div>
                        상호 : 유노바 ・ 대표 : 장진우 ・ 개인정보책임관리자 :
                        장진우 ・ 사업자등록번호 : 259-40-01233 ・{" "}
                        <a
                            href="#"
                            style={{
                                color: "inherit",
                                textDecoration: "underline",
                            }}
                        >
                            사업자정보확인
                        </a>{" "}
                        ・ 소재지 : 서울특별시 강남구 학동로 24길 20, 4층 402호
                        a411 ・ TEL : 050-6678-6390
                    </div>
                    <div style={{ marginTop: "0.5rem" }}>
                        이메일 : unova.team.cs@gmail.com ・ 운영시간 : 평일
                        13:00~21:00, 토요일 13:00~18:00, 일요일 휴무 ・
                        통신판매업 신고번호 : 2024-서울강남-06080
                    </div>
                    <div className="footer-copyright">
                        © 2025 NOVA AI. ALL RIGHTS RESERVED.
                    </div>
                </div>
            </div>
        </footer>
    );
}
