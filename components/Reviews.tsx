"use client";

interface Testimonial {
    quote: string;
    author: string;
    role: string;
}

const testimonials: Testimonial[] = [
    {
        quote: "Nova AI 덕분에 한글 문서 작업이 정말 편해졌어요.\n예전엔 복잡한 수식 때문에 시간을 많이 낭비했는데,\n이제는 설명만 하면 AI가 알아서 처리해줘요.",
        author: "김수진",
        role: "연구원",
    },
    {
        quote: "코딩을 전혀 몰라도 Nova AI로 깔끔한 코드를 만들 수 있어서 놀랐어요.\n제가 원하는 게 뭔지 정확히 알아차리고\n매번 훌륭한 결과물을 만들어줍니다.",
        author: "박지은",
        role: "교사",
    },
    {
        quote: "매주 많은 문서를 다루는데 Nova AI가 정말 큰 도움이 되고 있어요.\n며칠 걸리는 작업이 지금은 30분이면 끝나요.\n효율성이 정말 뛰어납니다.",
        author: "이준호",
        role: "문서담당자",
    },
    {
        quote: "내신 시험지를 만들 때 수식 입력이 가장 번거로웠는데 Nova AI로 완전히 해결됐어요. 원하는 것을 설명하면\n빠르게 수식을 작성해주니 정말 신기합니다.",
        author: "최영미",
        role: "교사",
    },
    {
        quote: "회사에서 저희 팀원들이 Nova AI를 열심히 사용 중인데 생산성이 눈에 띄게 올라갔어요.\n한글 문서 작업 시간을 50% 이상 단축한 것 같아요.",
        author: "박준호",
        role: "팀 리더",
    },
    {
        quote: "기존에 복잡한 통계표를 작성할 때 어려움이 많았는데,\n이제는 Nova AI로 정말 쉽게 만들 수 있어요.\nNova AI 덕분에 데이터 분석 작업이 훨씬 빨라졌습니다.",
        author: "이현지",
        role: "데이터 분석가",
    },
    {
        quote: "한글 파일 자동화는 Nova AI가 최고인 것 같아요.\n저희 팀 전체의 표준 도구로 자리잡았고,\n복잡한 반복 작업을 완전히 없애주었습니다.",
        author: "정재훈",
        role: "개발자",
    },
    {
        quote: "Nova AI를 매일 사용하는데 정말 안정적이고 정확해요.\n덕분에 디자인 전달 과정이 간소화되었고,\n수정 요청 대응 속도도 크게 빨라졌습니다.",
        author: "신은주",
        role: "디자이너",
    },
    {
        quote: "Nova AI 덕분에 논문 작성 시간이 절반으로 줄었어요.\n수식과 표 정리가 정말 쉬워졌고,\n편집 품질과 일관성이 크게 향상됐습니다.",
        author: "김도현",
        role: "대학원생",
    },
    {
        quote: "팀 전체에 Nova AI를 도입했는데 반응이 정말 좋아요.\n코딩 지식 없이도 누구나 쉽게 쓸 수 있어서\n팀원들의 만족도가 정말 높아요.",
        author: "우미현",
        role: "프로젝트 매니저",
    },
];

const StarIcon = () => (
    <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="currentColor"
        style={{ display: "inline-block" }}
    >
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
);

export default function Testimonials() {
    return (
        <section
            id="testimonials"
            className="section-base"
        >
            <div className="section-inner">
                <h2 className="benefits-title">
                    수많은 사용자가 사랑합니다
                </h2>
                <p className="benefits-subtitle benefits-subtitle-single">
                    수많은 사람들이 문서 자동화를 위해 Nova AI를 신뢰하는 이유를 확인하세요.
                </p>

                <div className="testimonial-marquee">
                    <div className="testimonial-track">
                        {[...testimonials, ...testimonials].map(
                            (testimonial, index) => (
                                <div
                                    key={index}
                                    className="testimonial-card"
                                >
                                    <div className="stars">
                                        {[...Array(5)].map((_, i) => (
                                            <span
                                                key={i}
                                                className="accent-yellow"
                                            >
                                                <StarIcon />
                                            </span>
                                        ))}
                                    </div>
                                    <p className="testimonial-quote">
                                        &ldquo;{testimonial.quote}&rdquo;
                                    </p>
                                    <div className="testimonial-author">
                                        {testimonial.author}
                                    </div>
                                    <div className="testimonial-role">
                                        {testimonial.role}
                                    </div>
                                </div>
                            )
                        )}
                    </div>
                </div>

            </div>
        </section>
    );
}
