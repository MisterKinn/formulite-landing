"use client";

interface HighlightStat {
    eyebrow: string;
    value: string;
    unit: string;
    caption: string;
}

const highlightStats: HighlightStat[] = [
    {
        eyebrow: "최대 처리량",
        value: "200",
        unit: "문제+",
        caption: "1시간 기준 자동 타이핑",
    },
    {
        eyebrow: "문항당 평균",
        value: "30",
        unit: "초",
        caption: "복잡한 수식도 빠르게 처리",
    },
    {
        eyebrow: "월 운영 비용",
        value: "29,900",
        unit: "원",
        caption: "월 330문제 기준 요금제",
    },
    {
        eyebrow: "작업 가능 시간",
        value: "24",
        unit: "시간",
        caption: "주말과 야간에도 즉시 가능",
    },
];

interface HighlightStatsProps {
    className?: string;
}

export default function HighlightStats({ className = "" }: HighlightStatsProps) {
    const classes = ["cc-highlight-grid", className].filter(Boolean).join(" ");

    return (
        <div className={classes} aria-label="Nova AI 핵심 성능 지표">
            {highlightStats.map((stat) => (
                <article key={stat.eyebrow} className="cc-highlight-card">
                    <p className="cc-highlight-eyebrow">{stat.eyebrow}</p>
                    <p className="cc-highlight-value">
                        <span>{stat.value}</span>
                        <strong>{stat.unit}</strong>
                    </p>
                    <p className="cc-highlight-caption">{stat.caption}</p>
                </article>
            ))}
        </div>
    );
}
