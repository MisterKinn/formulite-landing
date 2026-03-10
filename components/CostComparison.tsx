"use client";
import React from "react";

const Check = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6L9 17l-5-5" />
    </svg>
);

const X = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 6L6 18" />
        <path d="M6 6l12 12" />
    </svg>
);

interface Row {
    label: string;
    assistant: string;
    nova: string;
    /** true = nova is better, false = assistant is better, undefined = neutral */
    novaWin?: boolean;
    assistantBad?: boolean;
}

const rows: Row[] = [
    {
        label: "1시간 처리량",
        assistant: "최대 10문제",
        nova: "200문제 이상",
        novaWin: true,
    },
    {
        label: "수식 1문제 소요 시간",
        assistant: "약 6분",
        nova: "약 10초",
        novaWin: true,
    },
    {
        label: "수식 1문제당 비용",
        assistant: "약 1,200원",
        nova: "약 90원",
        novaWin: true,
        assistantBad: true,
    },
    {
        label: "월 비용 (하루 4h 기준)",
        assistant: "약 96만원",
        nova: "19,900원",
        novaWin: true,
        assistantBad: true,
    },
    {
        label: "오탈자 / 입력 오류",
        assistant: "사람이라 실수 불가피",
        nova: "AI 기반, 오류 없음",
        novaWin: true,
    },
    {
        label: "수식 정확도",
        assistant: "숙련도에 따라 편차",
        nova: "Gemini 3 Pro 추론 기반",
        novaWin: true,
    },
    {
        label: "24시간 / 주말 작업",
        assistant: "별도 협의 필요",
        nova: "언제든 즉시 가능",
        novaWin: true,
    },
    {
        label: "추가 인건비 (4대보험 등)",
        assistant: "별도 발생",
        nova: "없음",
        novaWin: true,
    },
];

export default function CostComparison() {
    return (
        <section id="cost-comparison" className="cc-section">
            <div className="cc-inner">
                {/* ── Header ── */}
                <div className="cc-header">
                    <h2 className="cc-title">조교를 고용하시겠습니까?</h2>
                    <p className="cc-subtitle">
                        조교 선생님이 수식을 직접 타이핑하면, 시급 12,000원 기준
                        <br />
                        한 시간에 최대 10문제가 한계입니다.
                    </p>
                </div>

                {/* ── Table ── */}
                <div className="cc-table-wrap">
                    {/* Column headers */}
                    <div className="cc-table-head">
                        <div className="cc-col cc-col--label" />
                        <div className="cc-col cc-col--assistant">
                            <span className="cc-col-title">조교 채용</span>
                        </div>
                        <div className="cc-col cc-col--nova">
                            <span className="cc-col-title">Nova AI</span>
                        </div>
                    </div>

                    {/* Rows */}
                    {rows.map((row, idx) => (
                        <div key={idx} className="cc-table-row">
                            <div className="cc-col cc-col--label">
                                {row.label}
                            </div>
                            <div className={`cc-col cc-col--assistant ${row.assistantBad ? "cc-val--bad" : ""}`}>
                                <X />
                                <span>{row.assistant}</span>
                            </div>
                            <div className={`cc-col cc-col--nova ${row.novaWin ? "cc-val--good" : ""}`}>
                                <Check />
                                <span>{row.nova}</span>
                            </div>
                        </div>
                    ))}
                </div>

                <p className="cc-bottom-text">
                    같은 업무량 기준, Nova AI는 조교 채용 대비 <strong>약 48배 저렴</strong>하며
                    <br />
                    <strong>오탈자 걱정이 전혀 없습니다.</strong>
                </p>
            </div>
        </section>
    );
}
