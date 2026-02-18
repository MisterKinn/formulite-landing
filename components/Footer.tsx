"use client";
import footerLogo from "../loooogo.png";

export default function Footer() {
    return (
        <footer className="footer">
            <div className="footer-inner">
                <a href="/" title="유노바" className="footer-brand">
                    <img
                        src={footerLogo.src}
                        alt="유노바 로고"
                        width={120}
                        height={33}
                    />
                </a>

                <div className="footer-company">
                    <p>유노바 대표: 장진우</p>
                    <p>사업자 등록번호 : 259-40-01233</p>
                    <p>서울특별시 강남구 학동로 24길 20, 4층 402호 a411</p>
                    <p>
                        Contact us :{" "}
                        <a
                            href="mailto:jjw7808a@naver.com"
                            className="footer-contact-link"
                        >
                            jjw7808a@naver.com
                        </a>
                    </p>
                    <p>
                        <a href="#" className="footer-contact-link">
                            사업자정보확인
                        </a>
                        {" ・ "}
                        통신판매업 신고번호 : 2024-서울강남-06080
                    </p>
                </div>

                <div className="footer-links-row">
                    <a href="/policy" className="footer-policy-link">
                        개인정보처리방침
                    </a>
                    <a href="/terms" className="footer-policy-link">
                        서비스 이용약관
                    </a>
                </div>

                <div className="footer-copyright">
                    © 2024 UNOVA. ALL RIGHTS RESERVED.
                </div>
            </div>
        </footer>
    );
}
