"use client";
import { useState } from "react";

const faqCategories = {
    일반: [
        {
            question: "Nova AI는 어떻게 작동하나요?",
            answer: "Nova AI가 사용자의 요청을 Python 코드로 변환하고, 이를 사용해 한글 파일을 자동으로 수정합니다.",
        },
        {
            question: "프로그래밍 지식이 필요한가요?",
            answer: "아니요, Nova AI 누구나 쉽게 사용할 수 있도록 설계되었습니다. 원하는 내용을 설명하면 AI가 Python 코드를 정확하게 생성합니다.",
        },
        {
            question: "어떤 운영체제를 지원하나요?",
            answer: "현재 Nova AI Windows, macOS, Linux 환경을 모두 지원합니다. 단, 한글 파일 수정은 Windows에서만 가능합니다.",
        },
        {
            question: "내 데이터는 안전한가요?",
            answer: "네, Nova AI 사용자의 데이터를 최우선으로 보호합니다. 모든 데이터는 암호화되어 전송되며, 서버에 저장되지 않고 즉시 처리 후 삭제됩니다.",
        },
    ],
    결제: [
        {
            question: "무료 체험 기간이 있나요?",
            answer: "네, 모든 신규 사용자에게 7일간의 무료 체험 기간을 제공합니다. 이 기간 동안 Plus 요금제 또는 Ultra 요금제의 모든 기능을 제한 없이 사용하실 수 있습니다.",
        },
        {
            question: "월간/연간 결제의 차이점이 무엇인가요?",
            answer: "연간 결제를 선택하면 월간 결제 대비 약 20% 할인을 받을 수 있습니다.",
        },
        {
            question: "업그레이드하면 추가 요금이 드나요?",
            answer: "업그레이드 시 현재 남은 기간에 대해 차액만 결제할 수 있도록 결제 금액이 조절됩니다.",
        },
        {
            question: "변경 사항은 언제 적용되나요?",
            answer: "플랜 변경은 결제 이후 즉시 적용됩니다. 결제와 동시에 새로운 기능과 혜택을 바로 누리실 수 있습니다.",
        },
    ],
    환불: [
        {
            question: "환불 정책은 어떻게 되나요?",
            answer: "환불 요청 시점을 기준으로 사용량에 따라 부분적으로 환불을 진행합니다. 자세한 환불 정책은 이용 약관을 참조하세요.",
        },
        {
            question: "환불 요청은 어떻게 하나요?",
            answer: "계정 설정의 '구독 관리' 메뉴에서 환불을 요청할 수 있습니다. 요청 후 2-3 영업일 내에 처리됩니다.",
        },
        {
            question: "환불 처리 시간은 얼마나 걸리나요?",
            answer: "환불 요청 후 2-3 영업일 내에 원결제 수단으로 환불됩니다. 카드사에 따라 추가적인 시간이 소요될 수 있습니다.",
        },
        {
            question: "환불 후 재구독이 가능한가요?",
            answer: "네, 환불 후에도 언제든지 다시 구독하실 수 있습니다. 이전 데이터나 설정은 30일간 보관되며, 재구독 시 복구 가능합니다.",
        },
    ],
};

const categoryLabels: Record<Category, string> = {
    일반: "일반",
    결제: "결제",
    환불: "환불",
};

type Category = keyof typeof faqCategories;

export default function FAQ() {
    const [activeCategory, setActiveCategory] = useState<Category>("일반");
    const [openFAQ, setOpenFAQ] = useState<number | null>(null);

    const currentFAQs = faqCategories[activeCategory];

    return (
        <section id="faq" className="section-base">
            <div className="section-inner container-narrow">
                <h2 className="benefits-title">
                    자주 묻는 질문
                </h2>
                <p className="benefits-subtitle">
                    Nova AI에 대해 자주 묻는 질문을 빠르게 확인하세요.
                </p>

                {/* Category tabs */}
                <div className="faq-tabs">
                    {(Object.keys(faqCategories) as Category[]).map(
                        (category) => (
                            <button
                                key={category}
                                className={`faq-tab ${
                                    activeCategory === category ? "active" : ""
                                }`}
                                onClick={() => {
                                    setActiveCategory(category);
                                    setOpenFAQ(null);
                                }}
                            >
                                {categoryLabels[category]}
                            </button>
                        )
                    )}
                </div>

                {/* FAQ items */}
                <div className="stack-4">
                    {currentFAQs.map((faq, index) => (
                        <div
                            key={index}
                            className={`faq-card${
                                openFAQ === index ? " open" : ""
                            }`}
                        >
                            <button
                                className="faq-question"
                                onClick={() =>
                                    setOpenFAQ(openFAQ === index ? null : index)
                                }
                            >
                                <span>{faq.question}</span>
                                <span
                                    className={`faq-toggle ${
                                        openFAQ === index ? "open" : ""
                                    }`}
                                >
                                    +
                                </span>
                            </button>
                            {openFAQ === index && (
                                <div className="faq-answer">{faq.answer}</div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
