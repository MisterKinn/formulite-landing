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
            answer: "Nova AI 데스크톱 앱은 Windows만 지원합니다. 한글 오토메이션과의 연동 때문에 macOS·Linux에서는 이용할 수 없습니다.",
        },
        {
            question: "내 데이터는 안전한가요?",
            answer: "네, Nova AI 사용자의 데이터를 최우선으로 보호합니다. 모든 데이터는 암호화되어 전송되며, 서버에 저장되지 않고 즉시 처리 후 삭제됩니다.",
        },
    ],
    결제: [
        {
            question: "무료 체험 기간이 있나요?",
            answer: "아니요, Plus·Ultra 요금제의 전체 기능을 제한 없이 쓰는 별도의 7일 무료 체험은 없습니다. 회원가입 후에는 Free 요금제로 바로 시작할 수 있으며, 안내된 AI 토큰 한도(약 7만 5천 토큰, 문제 약 3회분 기준) 안에서 이용하실 수 있습니다. 더 많은 사용량은 Go·Plus·Ultra 유료 플랜에서 선택하실 수 있습니다.",
        },
        {
            question: "월간/연간 결제의 차이점이 무엇인가요?",
            answer: "월간 결제는 매달 정기 결제되는 방식이고, 연간 결제는 1년치를 한 번에 결제하는 대신 월간 대비 30% 할인 혜택을 받을 수 있습니다.",
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
            answer: "월간 결제와 연간 결제 모두 결제일로부터 7일 이내에 환불을 요청할 수 있습니다. 7일 이내 요청한 경우에는 이미 사용한 토큰량에 해당하는 금액을 제외한 나머지 금액을 기준으로 환불이 진행됩니다. 7일이 지난 뒤에는 환불이 불가할 수 있으며, 자세한 환불 가능 여부는 이용 내역과 사용량을 기준으로 확인됩니다.",
        },
        {
            question: "월간/연간 결제 후 환불은 어떻게 요청하나요?",
            answer: "계정 설정의 '구독 관리' 메뉴에서 해지 또는 환불을 요청하실 수 있습니다. 요청 시 결제일 기준 7일 이내인지와 실제 사용한 토큰량을 함께 확인한 뒤 환불 금액이 산정됩니다. 7일 이내 요청하더라도 사용한 토큰량에 해당하는 금액은 차감될 수 있으며, 7일이 지난 경우에는 환불이 제한될 수 있습니다.",
        },
        {
            question: "환불 처리 시간은 얼마나 걸리나요?",
            answer: "환불 요청 후 2-3 영업일 내에 원결제 수단으로 환불됩니다. 카드사에 따라 추가적인 시간이 소요될 수 있습니다.",
        },
        {
            question: "환불 후 재구독이 가능한가요?",
            answer: "네, 환불 후에도 언제든지 월간 또는 연간 플랜으로 다시 구독하실 수 있습니다. 기존 작업 내역과 설정은 일정 기간 보관되며, 재구독 시 동일 계정으로 이어서 사용할 수 있습니다.",
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
                <h2 className="benefits-title faq-title">
                    자주 묻는 질문
                </h2>

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
