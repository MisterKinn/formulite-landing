"use client";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import examScene1 from "../un1.png";
import examScene2 from "../un2.png";
import examScene3 from "../un3.png";
import examScene4 from "../int4.png";
import examScene5 from "../int5.png";
import examScene6 from "../int6.png";

interface ExamItem {
    image: string;
    alt: string;
    buttonLabel: string;
    title: string;
    caption: string;
}

interface RecentPurchaseItem {
    id: string;
    email: string;
    planLabel: string;
    billingLabel: string;
    relativeTime: string;
    approvedAt: string;
    amountLabel: string;
}

const MAX_VISIBLE_PURCHASES = 4;

const items: ExamItem[] = [
    {
        image: examScene1.src,
        alt: "완벽한 수식 타이핑 결과 예시",
        buttonLabel: "완벽한 수식 타이핑",
        title: "완벽한 수식 타이핑",
        caption: "볼드체, 선적분, 삼중적분, 행렬 등 다양한 수식 기능을 제공합니다.",
    },
    {
        image: examScene2.src,
        alt: "보기 호출 및 이미지 삽입 예시",
        buttonLabel: "<보기> 호출",
        title: "<보기> 호출 및 삽입",
        caption: "보기 박스와 이미지를 정확한 위치에 삽입합니다.",
    },
    {
        image: examScene3.src,
        alt: "AI 해설 작성 예시",
        buttonLabel: "AI 해설 작성",
        title: "AI 해설 작성",
        caption: "풀이 과정을 자연스럽게 정리해 해설을 작성합니다.",
    },
    {
        image: examScene4.src,
        alt: "표 생성 기능 예시",
        buttonLabel: "표 생성 기능",
        title: "표 생성 기능",
        caption: "수정 없이 결과물을 만들고 표 합치기까지 자동으로 진행합니다.",
    },
    {
        image: examScene5.src,
        alt: "진하게와 밑줄 효과 예시",
        buttonLabel: "진하게+밑줄",
        title: "진하게+밑줄 효과",
        caption: "강조가 필요한 문장에 진하게와 밑줄 효과를 자연스럽게 적용합니다.",
    },
    {
        image: examScene6.src,
        alt: "한자 타이핑 예시",
        buttonLabel: "한자 타이핑",
        title: "한자 타이핑",
        caption: "한자가 포함된 긴 지문도 자연스럽고 정확하게 타이핑합니다.",
    },
];

export default function ExamTyping() {
    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    const [recentPurchases, setRecentPurchases] = useState<RecentPurchaseItem[]>([]);
    const [purchaseTrackIndex, setPurchaseTrackIndex] = useState(0);
    const [isPurchaseTrackAnimating, setIsPurchaseTrackAnimating] = useState(false);
    const currentIndex = activeIndex ?? 0;
    const activeItem = useMemo(() => items[currentIndex], [currentIndex]);
    const visiblePurchaseCount = Math.min(MAX_VISIBLE_PURCHASES, recentPurchases.length || 1);
    const purchaseLoopItems = useMemo(() => {
        if (recentPurchases.length <= visiblePurchaseCount) {
            return recentPurchases;
        }

        return [
            ...recentPurchases,
            ...recentPurchases,
            ...recentPurchases,
        ];
    }, [recentPurchases, visiblePurchaseCount]);

    const handleSceneChange = (nextIndex: number) => {
        const normalizedIndex = (nextIndex + items.length) % items.length;
        setActiveIndex(normalizedIndex);
    };

    useEffect(() => {
        let isMounted = true;

        const loadRecentPurchases = async () => {
            try {
                const response = await fetch("/api/payments/recent-live", {
                    cache: "no-store",
                });
                const data = (await response.json()) as {
                    items?: RecentPurchaseItem[];
                };

                if (!isMounted) return;

                setRecentPurchases(Array.isArray(data.items) ? data.items : []);
            } catch (error) {
                if (!isMounted) return;

                console.error("실시간 구매 현황 로딩 실패:", error);
                setRecentPurchases([]);
            }
        };

        void loadRecentPurchases();
        const intervalId = window.setInterval(() => {
            void loadRecentPurchases();
        }, 60000);

        return () => {
            isMounted = false;
            window.clearInterval(intervalId);
        };
    }, []);

    useEffect(() => {
        if (recentPurchases.length === 0) {
            setPurchaseTrackIndex(0);
            setIsPurchaseTrackAnimating(false);
            return;
        }

        setPurchaseTrackIndex(
            recentPurchases.length > visiblePurchaseCount ? recentPurchases.length : 0,
        );
        setIsPurchaseTrackAnimating(recentPurchases.length > visiblePurchaseCount);
    }, [recentPurchases, visiblePurchaseCount]);

    useEffect(() => {
        if (recentPurchases.length <= visiblePurchaseCount) {
            return;
        }

        const rotationIntervalId = window.setInterval(() => {
            setPurchaseTrackIndex((prevIndex) => prevIndex + 1);
        }, 2800);

        return () => {
            window.clearInterval(rotationIntervalId);
        };
    }, [recentPurchases, visiblePurchaseCount]);

    const handlePurchaseTrackTransitionEnd = () => {
        if (recentPurchases.length <= visiblePurchaseCount) {
            return;
        }

        if (purchaseTrackIndex < recentPurchases.length * 2) {
            return;
        }

        setIsPurchaseTrackAnimating(false);
        setPurchaseTrackIndex(recentPurchases.length);

        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                setIsPurchaseTrackAnimating(true);
            });
        });
    };

    return (
        <section id="exam-typing" className="exam-section">
            <div className="exam-inner">
                <div className="exam-header">
                    <h2 className="exam-title">완벽한 시험지 결과물을 만듭니다.</h2>
                    <p className="exam-subtitle">
                        수능·모의고사 스타일의 보기 박스, 글상자, 조건 박스 등
                        <br />
                        평가원 형식을 그대로 재현하여 한글 문서에 자동으로 삽입합니다.
                    </p>
                </div>

                <div className="exam-showcase-panel">
                    <div className="exam-stage">
                        <div className="exam-stage-visual" key={`${currentIndex}-${activeItem.image}`}>
                            <img
                                src={activeItem.image}
                                alt={activeItem.alt}
                                className="exam-stage-image"
                            />
                        </div>
                        <div className="exam-scene-overlay">
                            <div className="exam-scene-controls">
                                <div className="exam-scene-stack">
                                    <div className="exam-scene-switcher" aria-label="시험지 결과물 장면 선택">
                                        {items.map((item, index) => (
                                            <button
                                                key={item.buttonLabel}
                                                type="button"
                                                className={`exam-scene-button ${
                                                    activeIndex === index ? "exam-scene-button--active" : ""
                                                }`}
                                                onClick={() => handleSceneChange(index)}
                                                aria-pressed={activeIndex === index}
                                            >
                                                <span className="exam-scene-button-text">
                                                    {item.buttonLabel}
                                                </span>
                                                {activeIndex === index && (
                                                    <span className="exam-scene-button-detail">
                                                        <span className="exam-scene-button-detail-title">
                                                            {item.title}
                                                        </span>
                                                        <span className="exam-scene-button-detail-caption">
                                                            {item.caption}
                                                        </span>
                                                    </span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="exam-purchase-feed" aria-live="polite">
                    <div className="exam-purchase-feed__header">
                        <div>
                            <h3 className="exam-purchase-feed__title">실시간 구매 현황</h3>
                            <p className="exam-purchase-feed__subtitle">
                                많은 선생님들이 노바AI를 사용합니다
                            </p>
                        </div>
                        <span className="exam-purchase-feed__live">Live</span>
                    </div>

                    {purchaseLoopItems.length > 0 ? (
                        <div className="exam-purchase-feed__carousel">
                            <div className="exam-purchase-feed__viewport">
                                <div
                                    className={`exam-purchase-feed__track ${
                                        isPurchaseTrackAnimating
                                            ? "exam-purchase-feed__track--animated"
                                            : ""
                                    }`}
                                    style={
                                        {
                                            "--visible-purchase-count": visiblePurchaseCount,
                                            transform: `translateX(-${(purchaseTrackIndex * 100) / visiblePurchaseCount}%)`,
                                        } as CSSProperties
                                    }
                                    onTransitionEnd={handlePurchaseTrackTransitionEnd}
                                >
                                    {purchaseLoopItems.map((purchase, index) => (
                                        <div
                                            key={`${purchase.id}-${index}`}
                                            className="exam-purchase-feed__slide"
                                        >
                                            <article className="exam-purchase-card">
                                                <div className="exam-purchase-card__top">
                                                    <div className="exam-purchase-card__buyer">
                                                        <span className="exam-purchase-card__email">
                                                            {purchase.email} 구매
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="exam-purchase-card__bottom">
                                                    <strong className="exam-purchase-card__plan">
                                                        {purchase.planLabel}
                                                    </strong>
                                                    <time
                                                        className="exam-purchase-card__recent"
                                                        dateTime={purchase.approvedAt}
                                                    >
                                                        {purchase.relativeTime} 구매
                                                    </time>
                                                </div>
                                            </article>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="exam-purchase-feed__empty">
                            최근 구매 내역을 집계하고 있습니다.
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}
