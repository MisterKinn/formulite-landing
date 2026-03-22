"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getAuth } from "firebase/auth";
import { getFirebaseAppOrNull } from "../../firebaseConfig";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import { loadTossPayments } from "@tosspayments/tosspayments-sdk";
import { useAuth } from "../../context/AuthContext";
import "./profile.css";
import "../style.css";
import "../mobile.css";

import { Navbar } from "../../components/Navbar";
import Footer from "../../components/Footer";
import dynamic from "next/dynamic";
import {
    ESTIMATED_TOKENS_PER_PROBLEM,
    TIER_LIMITS,
} from "../../lib/tierLimits";
const Sidebar = dynamic(() => import("../../components/Sidebar"), {
    ssr: false,
});

// 토스페이먼츠 클라이언트 키 (테스트용)
const TOSS_CLIENT_KEY = "test_ck_D5GePWvyJnrK0W0k6q8gLzN97Eoq";

// 아이콘 컴포넌트들
const CheckIcon = () => (
    <svg
        className="plan-feature-icon"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <polyline points="20 6 9 17 4 12" />
    </svg>
);

const XIcon = () => (
    <svg
        className="plan-feature-icon"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
);

const SparklesIcon = () => (
    <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    </svg>
);

const ZapIcon = () => (
    <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
);

const CrownIcon = () => (
    <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14" />
    </svg>
);

// 플랜 데이터 타입
interface PlanData {
    id: string;
    name: string;
    description: string;
    monthlyPrice: number;
    yearlyPrice: number;
    features: { text: string; included: boolean }[];
    icon: React.ReactNode;
    popular?: boolean;
    ctaText: string;
}

interface AiUsageHistoryLog {
    id: string;
    model: string;
    provider: string;
    feature: string;
    source: string;
    promptTokens: number;
    outputTokens: number;
    totalTokens: number;
    createdAt: string;
}

const formatTokenAllowance = (baseProblems: number, bonusProblems?: number) => {
    const baseTokens = baseProblems * ESTIMATED_TOKENS_PER_PROBLEM;

    if (!bonusProblems) {
        return `총 ${baseTokens.toLocaleString("ko-KR")}토큰 AI 타이핑 생성`;
    }

    const bonusTokens = bonusProblems * ESTIMATED_TOKENS_PER_PROBLEM;
    return `월 ${baseTokens.toLocaleString("ko-KR")}토큰+${bonusTokens.toLocaleString("ko-KR")}토큰 AI 타이핑 생성`;
};

// 플랜 데이터
const plansData: PlanData[] = [
    {
        id: "free",
        name: "Free",
        description: "Nova AI를 처음 시작하는\n분들을 위한 가장 간단한 플랜",
        monthlyPrice: 0,
        yearlyPrice: 0,
        icon: <SparklesIcon />,
        features: [
            { text: formatTokenAllowance(3), included: true },
            { text: "기본 수식 자동화", included: true },
            { text: "광고 없는 경험", included: true },
            { text: "커뮤니티 지원", included: true },
            { text: "복수 계정 작업 불가능", included: true },
            { text: "AI 최적화 기능", included: false },
            { text: "코드 저장 & 관리", included: false },
        ],
        ctaText: "현재 플랜",
    },
    {
        id: "plus",
        name: "Plus 요금제",
        description: "더 많은 기능과\n우선 지원을 받으세요",
        monthlyPrice: 120,
        yearlyPrice: 120,
        icon: <ZapIcon />,
        popular: true,
        features: [
            { text: formatTokenAllowance(200, 20), included: true },
            { text: "고급 AI 모델", included: true },
            { text: "팀 공유 기능", included: true },
            { text: "우선 지원 서비스", included: true },
            { text: "복수 계정 작업 불가능", included: true },
            { text: "월 1회 1:1 컨설팅", included: true },
            { text: "API 액세스", included: false },
        ],
        ctaText: "Plus 요금제로 업그레이드",
    },
    {
        id: "test",
        name: "Test 요금제",
        description: "임시 결제 테스트를 위한\n짧은 주기의 테스트 플랜",
        monthlyPrice: 100,
        yearlyPrice: 100,
        icon: <ZapIcon />,
        features: [
            { text: "1분 주기 테스트 결제", included: true },
            {
                text: `Plus와 동일 사용량 한도 (${formatTokenAllowance(200, 20)})`,
                included: true,
            },
            { text: "결제 플로우 점검", included: true },
            { text: "팀 공유 기능", included: false },
            { text: "전담 지원 서비스", included: false },
            { text: "운영 중 제거 예정", included: true },
            { text: "API 액세스", included: false },
        ],
        ctaText: "Test 요금제로 시작",
    },
    {
        id: "pro",
        name: "Ultra 요금제",
        description: "모든 프리미엄 기능을 위한\n가장 강력한 플랜",
        monthlyPrice: 99000,
        yearlyPrice: 69300,
        icon: <CrownIcon />,
        features: [
            { text: formatTokenAllowance(1200, 120), included: true },
            { text: "고급 AI 모델", included: true },
            { text: "팀 협업 기능", included: true },
            { text: "API 액세스", included: true },
            { text: "전담 지원 서비스", included: true },
            { text: "복수 계정 작업 가능", included: true },
            { text: "최우선 업데이트", included: true },
            { text: "맞춤형 기능 요청", included: true },
        ],
        ctaText: "Ultra 요금제로 업그레이드",
    },
];

function formatTokenCount(value: number | null | undefined): string {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return "-";
    }
    return `${Math.max(0, Math.floor(value)).toLocaleString("ko-KR")} 토큰`;
}

// Helper function to get tier order for comparison
function getTierOrder(planId: string): number {
    const tierOrder: { [key: string]: number } = {
        free: 0,
        go: 1,
        test: 1.5,
        plus: 2,
        pro: 3,
    };
    return tierOrder[planId] ?? 0;
}

// Helper function to get CTA text based on current plan
function getCtaText(planId: string, currentPlanId: string): string {
    const planOrder = getTierOrder(planId);
    const currentOrder = getTierOrder(currentPlanId);

    if (planOrder < currentOrder) {
        // Downgrade
        const planNames: { [key: string]: string } = {
            free: "Free로",
            go: "Go 요금제로",
            test: "Test 요금제로",
            plus: "Plus 요금제로",
            pro: "Ultra 요금제로",
        };
        return `${planNames[planId]}<br />다운그레이드`;
    } else {
        // Upgrade
        const planNames: { [key: string]: string } = {
            free: "Free로",
            go: "Go 요금제로",
            test: "Test 요금제로",
            plus: "Plus 요금제로",
            pro: "Ultra 요금제로",
        };
        return `${planNames[planId]}<br />업그레이드`;
    }
}

export default function ProfilePage() {
    return (
        <React.Suspense
            fallback={
                <div
                    style={{
                        minHeight: "100vh",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    Loading...
                </div>
            }
        >
            <ProfileContent />
        </React.Suspense>
    );
}

function ProfileContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const {
        user: authUser,
        logout,
    } = useAuth();

    const [email, setEmail] = useState("");
    const [status, setStatus] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<"profile" | "payment">(
        "profile",
    );
    const billingCycle: "yearly" = "yearly";
    const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<boolean>(false);
    const [subscription, setSubscription] = useState<any>(null);
    const [loadingSubscription, setLoadingSubscription] = useState(true);
    const [accountPlan, setAccountPlan] = useState<string | null>(null);
    const [aiUsage, setAiUsage] = useState<{
        currentUsage: number;
        limit: number;
        plan: string;
    } | null>(null);
    const [paymentHistory, setPaymentHistory] = useState<any[]>([]);
    const [loadingPayments, setLoadingPayments] = useState(false);
    const [usageHistory, setUsageHistory] = useState<AiUsageHistoryLog[]>([]);
    const [usageHistoryOpen, setUsageHistoryOpen] = useState(false);
    const [loadingUsageHistory, setLoadingUsageHistory] = useState(false);

    // Refresh key for forcing data reload
    const [refreshKey, setRefreshKey] = useState(0);

    const loadAccountProfile = useCallback(async () => {
        if (!authUser) {
            setEmail("");
            setAccountPlan(null);
            return;
        }

        setEmail(authUser.email || "");

        try {
            const firebaseApp = getFirebaseAppOrNull();
            if (!firebaseApp) return;
            const db = getFirestore(firebaseApp);
            const docRef = doc(db, "users", authUser.uid);
            const snap = await getDoc(docRef);
            if (snap.exists()) {
                const data = snap.data() as any;
                if (data?.email) setEmail(data.email);
                if (typeof data?.plan === "string") {
                    setAccountPlan(data.plan);
                } else if (typeof data?.tier === "string") {
                    setAccountPlan(data.tier);
                } else {
                    setAccountPlan(null);
                }
            } else {
                setAccountPlan(null);
            }
        } catch (err) {
            console.warn("Failed to load profile from Firestore", err);
        }
    }, [authUser]);

    // Load subscription data
    useEffect(() => {
        async function loadSubscription() {
            if (!authUser) return;

            try {
                const { getSubscription } = await import("@/lib/subscription");
                const data = await getSubscription(authUser.uid);
                setSubscription(data);
            } catch (error) {
                console.error("Failed to load subscription:", error);
            } finally {
                setLoadingSubscription(false);
            }
        }

        loadSubscription();
    }, [authUser, refreshKey]);

    // Refresh data when page gains focus (e.g., returning from payment)
    useEffect(() => {
        const handleFocus = () => {
            setRefreshKey((k) => k + 1);
        };

        window.addEventListener("focus", handleFocus);
        return () => window.removeEventListener("focus", handleFocus);
    }, []);

    // Load AI usage data - reload when subscription changes
    useEffect(() => {
        async function loadAiUsage() {
            if (!authUser) return;
            const getLimitByPlan = (rawPlan: unknown) => {
                const plan = String(rawPlan || "free").toLowerCase();
                if (plan === "pro" || plan === "ultra") return TIER_LIMITS.pro;
                if (plan === "go") return TIER_LIMITS.go;
                if (plan === "plus" || plan === "test") return TIER_LIMITS.plus;
                return TIER_LIMITS.free;
            };
            let resolved = false;

            try {
                const response = await fetch(
                    `/api/ai/check-limit?userId=${authUser.uid}&t=${Date.now()}`,
                    { cache: "no-store" },
                );
                if (response.ok) {
                    const data = await response.json();
                    setAiUsage({
                        currentUsage: data.currentUsage,
                        limit: data.limit,
                        plan: data.plan,
                    });
                    resolved = true;
                }
            } catch (error) {
                console.error("Failed to load AI usage:", error);
            }

            if (!resolved) {
                try {
                    const firebaseApp = getFirebaseAppOrNull();
                    if (firebaseApp) {
                        const db = getFirestore(firebaseApp);
                        const userRef = doc(db, "users", authUser.uid);
                        const userSnap = await getDoc(userRef);
                        if (userSnap.exists()) {
                            const userData = userSnap.data() as any;
                            const plan =
                                userData?.subscription?.plan ||
                                userData?.plan ||
                                "free";
                            const rawUsage = Number(userData?.aiCallUsage ?? 0);
                            const currentUsage =
                                Number.isFinite(rawUsage) && rawUsage > 0
                                    ? rawUsage < 10000
                                        ? rawUsage * ESTIMATED_TOKENS_PER_PROBLEM
                                        : rawUsage
                                    : 0;
                            setAiUsage({
                                currentUsage,
                                limit: getLimitByPlan(plan),
                                plan: String(plan),
                            });
                            resolved = true;
                        }
                    }
                } catch (fallbackError) {
                    console.error(
                        "Failed to load fallback AI usage:",
                        fallbackError,
                    );
                }
            }

            if (!resolved) {
                setAiUsage(null);
            }
        }

        loadAiUsage();
    }, [authUser, subscription?.plan, refreshKey]);

    useEffect(() => {
        if (!authUser) return;
        let mounted = true;
        const refreshUsage = async () => {
            try {
                const response = await fetch(
                    `/api/ai/check-limit?userId=${authUser.uid}&t=${Date.now()}`,
                    { cache: "no-store" },
                );
                if (!response.ok) return;
                const data = await response.json();
                if (!mounted) return;
                setAiUsage({
                    currentUsage: data.currentUsage,
                    limit: data.limit,
                    plan: data.plan,
                });
            } catch (err) {
                // non-fatal
            }
        };

        const timer = window.setInterval(refreshUsage, 15000);
        return () => {
            mounted = false;
            window.clearInterval(timer);
        };
    }, [authUser]);

    // Load payment history
    useEffect(() => {
        async function loadPaymentHistory() {
            if (!authUser) return;
            setLoadingPayments(true);

            try {
                const response = await fetch(
                    `/api/payments/history?userId=${authUser.uid}`,
                );
                if (response.ok) {
                    const data = await response.json();
                    setPaymentHistory(data.payments || []);
                }
            } catch (error) {
                console.error("Failed to load payment history:", error);
            } finally {
                setLoadingPayments(false);
            }
        }

        loadPaymentHistory();
    }, [authUser, refreshKey]);

    // Check for tab query parameter and sessionStorage
    useEffect(() => {
        // First, check URL query parameter
        const tabParam = searchParams?.get("tab");
        if (tabParam === "payment" || tabParam === "profile") {
            setActiveTab(tabParam);
            return;
        }

        // Then, check sessionStorage
        const savedTab = sessionStorage.getItem("profileTab");
        if (savedTab === "payment" || savedTab === "profile") {
            setActiveTab(savedTab);
            sessionStorage.removeItem("profileTab");
        }
    }, [searchParams]);

    useEffect(() => {
        void loadAccountProfile();
    }, [loadAccountProfile, refreshKey]);

    useEffect(() => {
        if (!authUser) return;
        const timer = window.setInterval(() => {
            void loadAccountProfile();
        }, 15000);
        return () => window.clearInterval(timer);
    }, [authUser, loadAccountProfile]);

    // 가격 포맷팅
    const formatPrice = (price: number) => {
        return price.toLocaleString("ko-KR");
    };

    // Map plan id to icon component
    const getPlanIcon = (planId?: string) => {
        if (planId === "pro") return <CrownIcon />;
        if (planId === "plus" || planId === "go" || planId === "test") {
            return <ZapIcon />;
        }
        return <SparklesIcon />;
    };

    // Get plan display info
    const getPlanInfo = (planId?: string) => {
        const plan = planId || "free";
        const planMap: Record<string, { name: string; description: string }> = {
            pro: {
                name: "Ultra 요금제",
                description: "모든 프리미엄 기능을 이용 중입니다",
            },
            go: {
                name: "Go 요금제",
                description: "핵심 기능을 합리적인 가격으로 이용 중입니다",
            },
            plus: {
                name: "Plus 요금제",
                description: "전문 기능을 이용 중입니다",
            },
            test: {
                name: "Test 요금제",
                description: "임시 테스트 결제를 이용 중입니다",
            },
            free: {
                name: "Free",
                description: "기본 기능을 이용 중입니다",
            },
        };
        return planMap[plan] || planMap.free;
    };

    const normalizePlan = (
        value?: unknown,
    ): "free" | "go" | "plus" | "pro" | "test" => {
        if (typeof value !== "string") return "free";
        const normalized = value.trim().toLowerCase();
        if (normalized === "pro" || normalized === "ultra") return "pro";
        if (normalized === "go") return "go";
        if (normalized === "plus" || normalized === "test") return normalized;
        return "free";
    };

    const inferPlanFromOrderName = (
        orderName?: unknown,
    ): "free" | "go" | "plus" | "pro" | "test" => {
        if (typeof orderName !== "string") return "free";
        const normalized = orderName.toLowerCase();
        if (normalized.includes("ultra") || normalized.includes("pro")) return "pro";
        if (normalized.includes("test")) return "test";
        if (normalized.includes("go")) return "go";
        if (normalized.includes("plus")) return "plus";
        return "free";
    };

    const resolveSubscriptionEndDate = () => {
        const directDateCandidate =
            subscription?.expiresAt ||
            subscription?.expireAt ||
            subscription?.expirationDate ||
            subscription?.nextBillingDate;

        if (directDateCandidate) {
            const parsed = new Date(directDateCandidate);
            if (!Number.isNaN(parsed.getTime())) {
                return parsed;
            }
        }

        const startDateCandidate =
            subscription?.lastPaymentDate ||
            subscription?.billingStartDate ||
            subscription?.startDate ||
            subscription?.registeredAt;

        if (startDateCandidate) {
            const startedAt = new Date(startDateCandidate);
            if (!Number.isNaN(startedAt.getTime())) {
                const cycle = subscription?.billingCycle;
                if (cycle === "yearly") {
                    startedAt.setDate(startedAt.getDate() + 365);
                } else if (cycle === "test") {
                    startedAt.setTime(startedAt.getTime() + 60 * 1000);
                } else {
                    startedAt.setDate(startedAt.getDate() + 30);
                }
                return startedAt;
            }
        }

        const latestPaid = paymentHistory.find((payment) => {
            const status = String(payment?.status || "").toUpperCase();
            const amount = Number(payment?.amount || 0);
            return status === "DONE" && amount > 0;
        });
        if (latestPaid?.approvedAt) {
            const approvedAt = new Date(latestPaid.approvedAt);
            if (!Number.isNaN(approvedAt.getTime())) {
                const isYearly =
                    typeof latestPaid?.orderName === "string" &&
                    (latestPaid.orderName.includes("연간") ||
                        latestPaid.orderName.toLowerCase().includes("year"));
                approvedAt.setDate(approvedAt.getDate() + (isYearly ? 365 : 30));
                return approvedAt;
            }
        }

        return null;
    };

    const isCancelledSubscriptionEnded = () => {
        const subscriptionStatus = String(subscription?.status || "").toLowerCase();
        if (subscriptionStatus === "expired") {
            return true;
        }
        if (subscriptionStatus !== "cancelled") {
            return false;
        }

        const endDate = resolveSubscriptionEndDate();
        return !!endDate && endDate.getTime() <= Date.now();
    };

    const getEffectivePlanId = () => {
        const subscriptionStatus = String(subscription?.status || "").toLowerCase();
        const fromSubscription = normalizePlan(subscription?.plan);
        if (fromSubscription !== "free" && !isCancelledSubscriptionEnded()) {
            return fromSubscription;
        }

        const accountPlanId = normalizePlan(accountPlan);
        if (typeof accountPlan === "string" && accountPlanId !== "free") {
            return accountPlanId;
        }

        const fromUsage = normalizePlan(aiUsage?.plan);
        if (fromUsage !== "free") return fromUsage;

        const hasExplicitFreePlan =
            (typeof accountPlan === "string" && accountPlanId === "free") ||
            (!!subscription &&
                (normalizePlan(subscription?.plan) === "free" ||
                    subscriptionStatus === "expired" ||
                    isCancelledSubscriptionEnded()));

        if (hasExplicitFreePlan) return "free";

        const latestPaid = paymentHistory.find((payment) => {
            const status = String(payment?.status || "").toUpperCase();
            const amount = Number(payment?.amount || 0);
            return status === "DONE" && amount > 0;
        });
        return inferPlanFromOrderName(latestPaid?.orderName);
    };

    const getPlanExpiryDate = () => {
        if (
            typeof accountPlan === "string" &&
            normalizePlan(accountPlan) === "free" &&
            normalizePlan(subscription?.plan) === "free"
        ) {
            return null;
        }

        const subscriptionStatus = String(subscription?.status || "").toLowerCase();
        if (
            subscription &&
            (normalizePlan(subscription?.plan) === "free" ||
                subscriptionStatus === "expired" ||
                isCancelledSubscriptionEnded())
        ) {
            return null;
        }

        return resolveSubscriptionEndDate();
    };

    const isPlanResolving = loadingSubscription || loadingPayments;
    const effectivePlanId = isPlanResolving ? "free" : getEffectivePlanId();
    const effectivePlanInfo = isPlanResolving
        ? {
              name: "요금제 확인 중",
              description: "결제 정보와 사용량을 동기화하고 있습니다",
          }
        : getPlanInfo(effectivePlanId);
    const planExpiryDate = getPlanExpiryDate();
    const fallbackLimitByPlan = (planId: string) => {
        const normalized = planId.toLowerCase();
        if (normalized === "pro" || normalized === "ultra") return TIER_LIMITS.pro;
        if (normalized === "go") return TIER_LIMITS.go;
        if (normalized === "plus" || normalized === "test") return TIER_LIMITS.plus;
        return TIER_LIMITS.free;
    };
    const fallbackPlanId = effectivePlanId;
    const questionUsage =
        aiUsage ||
        (isPlanResolving
            ? null
            : {
                  currentUsage: 0,
                  limit: fallbackLimitByPlan(fallbackPlanId),
                  plan: fallbackPlanId,
              });
    const profileDisplayName =
        authUser?.displayName?.trim() || email.split("@")[0] || "사용자";
    const profileInitial = profileDisplayName.charAt(0).toUpperCase();
    const remainingQuestions = questionUsage
        ? Math.max(0, questionUsage.limit - questionUsage.currentUsage)
        : null;
    const usageProgress = questionUsage
        ? Math.min(
              Math.round(
                  (questionUsage.currentUsage / Math.max(1, questionUsage.limit)) *
                      100,
              ),
              100,
          )
        : 0;
    const billingStartDate =
        subscription?.billingStartDate || subscription?.startDate || null;
    const completedPayments = paymentHistory.filter((payment) => {
        const paymentStatus = String(payment?.status || "").toUpperCase();
        return paymentStatus === "DONE" && Number(payment?.amount || 0) > 0;
    });
    const totalPaidAmount = completedPayments.reduce(
        (sum, payment) => sum + Number(payment?.amount || 0),
        0,
    );
    const rawSubscriptionStatus = String(subscription?.status || "").toLowerCase();
    const subscriptionStatus = (
        effectivePlanId === "free"
            ? "free"
            : rawSubscriptionStatus || "active"
    ).toLowerCase();
    const subscriptionStatusLabel =
        subscriptionStatus === "cancelled"
            ? "해지 예정"
            : subscriptionStatus === "suspended"
              ? "일시정지"
              : effectivePlanId === "free"
                ? "무료 이용 중"
                : "이용 중";
    const subscriptionStatusTone =
        subscriptionStatus === "cancelled"
            ? "cancelled"
            : subscriptionStatus === "suspended"
              ? "suspended"
              : effectivePlanId === "free"
                ? "free"
                : "active";
    const formatDateLabel = (
        value?: string | Date | null,
        includeTime = false,
    ) => {
        if (!value) return "-";
        const parsed = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(parsed.getTime())) return "-";
        return includeTime
            ? parsed.toLocaleString("ko-KR", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
              })
            : parsed.toLocaleDateString("ko-KR", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
              });
    };
    const formatCurrency = (value: number) =>
        `${value.toLocaleString("ko-KR")}원`;

    // 구독 결제 처리
    const handleSubscribe = async (plan: PlanData) => {
        if (!authUser) {
            setError("로그인이 필요합니다.");
            return;
        }

        const currentPlanId = subscription?.plan || "free";
        const targetPlanOrder = getTierOrder(plan.id);
        const currentPlanOrder = getTierOrder(currentPlanId);

        // Handle downgrade
        if (targetPlanOrder < currentPlanOrder) {
            const confirmMessage =
                plan.id === "free"
                    ? "Free로 다운그레이드하시겠습니까? 프리미엄 기능을 더 이상 사용할 수 없습니다."
                    : `${plan.name}로 다운그레이드하시겠습니까? 일부 기능이 제한됩니다.`;

            if (!confirm(confirmMessage)) {
                return;
            }

            setLoadingPlan(plan.id);

            try {
                // Get Firebase Auth token
                const auth = getAuth();
                const currentUser = auth.currentUser;
                if (!currentUser) {
                    throw new Error("사용자 인증 실패");
                }
                const token = await currentUser.getIdToken();

                // Call API to change plan
                const response = await fetch("/api/subscription/change-plan", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        plan: plan.id,
                        billingCycle: billingCycle,
                    }),
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || "플랜 변경 실패");
                }

                // Reload subscription data
                const { getSubscription } = await import("@/lib/subscription");
                const data = await getSubscription(authUser.uid);
                setSubscription(data);

                setStatus(`${plan.name}로 변경되었습니다.`);
                setTimeout(() => setStatus(null), 3000);
            } catch (err) {
                console.error("플랜 변경 오류:", err);
                setError(
                    err instanceof Error
                        ? err.message
                        : "플랜 변경 중 오류가 발생했습니다. 다시 시도해주세요.",
                );
            } finally {
                setLoadingPlan(null);
            }
            return;
        }

        // Handle upgrade - redirect to payment for paid plans
        if (plan.id === "free") {
            return;
        }

        setLoadingPlan(plan.id);

        try {
            const planNameMap: Record<string, string> = {
                go: "Go",
                test: "Test",
                plus: "Plus",
                pro: "Ultra",
            };
            const planName = planNameMap[plan.id] || plan.name;
            const planAmount = plan.monthlyPrice;
            const orderName = `Nova AI ${planName} 요금제`;
            const nextBillingCycle = plan.id === "test" ? "test" : "monthly";

            const clientKey =
                process.env.NEXT_PUBLIC_TOSS_BILLING_CLIENT_KEY?.trim() ||
                process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY?.trim() ||
                "";

            const tossPayments = await loadTossPayments(clientKey);
            const customerKey = `user_${authUser.uid
                .replace(/[^a-zA-Z0-9\-_=.@]/g, "")
                .substring(0, 40)}`;
            const payment = tossPayments.payment({ customerKey });

            await payment.requestBillingAuth({
                method: "CARD",
                successUrl: `${window.location.origin}/card-registration/success?amount=${planAmount}&orderName=${encodeURIComponent(orderName)}&billingCycle=${nextBillingCycle}`,
                failUrl: `${window.location.origin}/card-registration/fail?amount=${planAmount}&orderName=${encodeURIComponent(orderName)}`,
                customerEmail: authUser.email || "customer@example.com",
                customerName: authUser.displayName || "고객",
            });
        } catch (err: unknown) {
            console.error("결제 오류:", err);
            const error = err as { code?: string; message?: string };
            if (error?.code !== "USER_CANCEL") {
                setError(
                    error?.message || "결제 처리 중 오류가 발생했습니다. 다시 시도해주세요.",
                );
            }
        } finally {
            setLoadingPlan(null);
        }
    };

    // 구독 취소
    const handleCancelSubscription = async () => {
        if (!authUser) return;
        if (!subscription?.billingKey) {
            setError("구독 정보를 확인한 뒤 다시 시도해주세요.");
            return;
        }

        if (
            !confirm(
                "다음 정기결제를 해지하시겠습니까? 현재 플랜은 만료일까지 계속 이용할 수 있습니다.",
            )
        ) {
            return;
        }

        try {
            const auth = getAuth();
            const currentUser = auth.currentUser;
            if (!currentUser) {
                throw new Error("사용자 인증 실패");
            }
            const token = await currentUser.getIdToken();

            // Call API to cancel billing key with TossPayments and update Firestore
            const response = await fetch("/api/billing/cancel", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ userId: authUser.uid }),
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.error || "구독 취소에 실패했습니다");
            }

            setSubscription({
                ...subscription,
                status: "cancelled",
                billingKey: null,
                customerKey: null,
                isRecurring: false,
                cancelledAt:
                    result?.subscription?.cancelledAt ||
                    new Date().toISOString(),
            });

            setStatus(
                "다음 정기결제가 해지되었습니다. 만료일까지는 현재 플랜을 이용할 수 있습니다.",
            );
            setRefreshKey((k) => k + 1); // Refresh data
        } catch (error: any) {
            console.error("Failed to cancel subscription:", error);
            setError(
                error?.message ||
                    "구독 취소에 실패했습니다. 다시 시도해주세요.",
            );
        }
    };

    const handleLogout = async () => {
        try {
            await logout();
            router.push("/");
        } catch (error) {
            console.error("Logout error:", error);
            setError("로그아웃 중 오류가 발생했습니다.");
        }
    };

    const handleDeleteAccount = async () => {
        const confirmed =
            typeof window !== "undefined"
                ? window.confirm(
                      "정말로 계정을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.",
                  )
                : true;
        if (!confirmed) return;

        const firebaseApp = getFirebaseAppOrNull();
        if (!firebaseApp) {
            setError("Firebase 설정이 없어 이 기능을 사용할 수 없습니다.");
            return;
        }

        const auth = getAuth(firebaseApp);
        const currentUser = auth.currentUser;
        if (!currentUser) {
            setError("계정을 삭제하려면 로그인이 필요합니다.");
            return;
        }

        setDeleting(true);
        try {
            const idToken = await currentUser.getIdToken(true);
            const response = await fetch("/api/auth/delete-account", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${idToken}`,
                    "Content-Type": "application/json",
                },
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.success) {
                throw new Error(
                    payload?.message ||
                        payload?.error ||
                        "계정 삭제 요청에 실패했습니다.",
                );
            }

            setStatus("계정이 삭제되었습니다.");
            setError(null);

            // Local auth state cleanup
            try {
                await logout();
            } catch {
                router.push("/");
            }
        } catch (err: any) {
            console.error("Account deletion failed", err);
            setError(
                err?.message ||
                    "계정 삭제 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
            );
        } finally {
            setDeleting(false);
        }
    };

    const handleOpenUsageHistory = async () => {
        if (!authUser) return;

        setUsageHistoryOpen(true);
        setLoadingUsageHistory(true);
        try {
            const idToken = await authUser.getIdToken();
            const response = await fetch(
                `/api/ai/usage-history?userId=${encodeURIComponent(authUser.uid)}&limit=40`,
                {
                    headers: {
                        Authorization: `Bearer ${idToken}`,
                    },
                    cache: "no-store",
                },
            );
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.success) {
                throw new Error(payload?.error || "토큰 사용 이력을 불러오지 못했습니다.");
            }
            setUsageHistory(Array.isArray(payload.logs) ? payload.logs : []);
        } catch (err: any) {
            console.error("Failed to load usage history", err);
            setUsageHistory([]);
            setError(err?.message || "토큰 사용 이력을 불러오지 못했습니다.");
        } finally {
            setLoadingUsageHistory(false);
        }
    };

    return (
        <>
            <div className="desktop-navbar">
                <Navbar />
            </div>
            <div className="mobile-sidebar-container">
                <Sidebar />
            </div>

            <main className="profile-container">
                <div className="profile-layout">
                    <aside className="profile-sidebar">
                        <div className="profile-sidebar-card">
                            <span className="profile-sidebar-kicker">
                                My Page
                            </span>
                            <strong className="profile-sidebar-email">
                                {email || authUser?.email || "계정 확인 중"}
                            </strong>
                            <p className="profile-sidebar-copy">
                                계정 정보와 결제 상태를 한 곳에서 관리하세요.
                            </p>

                            <nav className="profile-nav">
                                <button
                                    className={`profile-nav-item ${
                                        activeTab === "profile" ? "active" : ""
                                    }`}
                                    onClick={() => setActiveTab("profile")}
                                >
                                    <svg
                                        width="18"
                                        height="18"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.5"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <circle cx="12" cy="8" r="4" />
                                        <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
                                    </svg>
                                    <span>프로필</span>
                                </button>
                                <button
                                    className={`profile-nav-item ${
                                        activeTab === "payment" ? "active" : ""
                                    }`}
                                    onClick={() => setActiveTab("payment")}
                                >
                                    <svg
                                        width="18"
                                        height="18"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.5"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                                    </svg>
                                    <span>결제내역</span>
                                </button>
                            </nav>
                        </div>
                    </aside>

                    <section className="profile-main">
                        <nav
                            className="profile-top-nav"
                            role="tablist"
                            aria-label="프로필 탭"
                        >
                            <button
                                role="tab"
                                aria-selected={activeTab === "profile"}
                                className={`profile-nav-item ${
                                    activeTab === "profile" ? "active" : ""
                                }`}
                                onClick={() => setActiveTab("profile")}
                            >
                                <svg
                                    width="18"
                                    height="18"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <circle cx="12" cy="8" r="4" />
                                    <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
                                </svg>
                                <span>프로필</span>
                            </button>
                            <button
                                role="tab"
                                aria-selected={activeTab === "payment"}
                                className={`profile-nav-item ${
                                    activeTab === "payment" ? "active" : ""
                                }`}
                                onClick={() => setActiveTab("payment")}
                            >
                                <svg
                                    width="18"
                                    height="18"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                                </svg>
                                <span>결제내역</span>
                            </button>
                        </nav>

                        <section className="profile-hero-card">
                            <div className="profile-hero-main">
                                <div className="profile-hero-avatar">
                                    {authUser?.photoURL ? (
                                        <img
                                            src={authUser.photoURL}
                                            alt="프로필 이미지"
                                            className="profile-hero-avatar-img"
                                        />
                                    ) : (
                                        <span>{profileInitial}</span>
                                    )}
                                </div>
                                <div className="profile-hero-copy">
                                    <span className="profile-hero-kicker">
                                        Nova AI 마이페이지
                                    </span>
                                    <h1 className="profile-hero-title">
                                        {profileDisplayName}
                                    </h1>
                                    <p className="profile-hero-subtitle">
                                        {email || authUser?.email || "로그인 정보를 불러오는 중입니다."}
                                    </p>
                                </div>
                            </div>

                            <div className="profile-hero-stats">
                                <div className="profile-stat-card">
                                    <span>이용 중 플랜</span>
                                    <strong>{effectivePlanInfo.name}</strong>
                                    <p>{subscriptionStatusLabel}</p>
                                </div>
                                <div className="profile-stat-card">
                                    <span>남은 토큰</span>
                                    <strong>
                                        {formatTokenCount(remainingQuestions)}
                                    </strong>
                                    <p>
                                        전체 한도{" "}
                                        {questionUsage
                                            ? formatTokenCount(questionUsage.limit)
                                            : "확인 중"}
                                    </p>
                                </div>
                                <div className="profile-stat-card">
                                    <span>다음 갱신일</span>
                                    <strong>
                                        {formatDateLabel(planExpiryDate)}
                                    </strong>
                                    <p>
                                        {billingStartDate
                                            ? `시작일 ${formatDateLabel(
                                                  billingStartDate,
                                              )}`
                                            : "결제 기준으로 자동 갱신됩니다"}
                                    </p>
                                </div>
                            </div>
                        </section>

                        {error && (
                            <div className="profile-alert profile-alert-error">
                                <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <circle cx="12" cy="12" r="10" />
                                    <line x1="12" y1="8" x2="12" y2="12" />
                                    <line
                                        x1="12"
                                        y1="16"
                                        x2="12.01"
                                        y2="16"
                                    />
                                </svg>
                                <span>{error}</span>
                            </div>
                        )}
                        {status && (
                            <div className="profile-alert profile-alert-success">
                                <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>
                                <span>{status}</span>
                            </div>
                        )}

                        {activeTab === "profile" ? (
                            <div className="profile-card-stack">
                                <section className="profile-card">
                                    <div className="profile-card-head">
                                        <div>
                                            <h2>계정 정보</h2>
                                            <p>
                                                기본 프로필과 현재 이용 상태를
                                                확인합니다.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="profile-info-grid">
                                        <div className="profile-info-item">
                                            <span className="profile-info-label">
                                                이메일
                                            </span>
                                            <strong>{email || "-"}</strong>
                                            <p>
                                                로그인 식별자로 사용되며 변경할 수
                                                없습니다.
                                            </p>
                                        </div>
                                        <div className="profile-info-item">
                                            <span className="profile-info-label">
                                                현재 플랜
                                            </span>
                                            <strong>{effectivePlanInfo.name}</strong>
                                            <p>
                                                {effectivePlanInfo.description}
                                            </p>
                                        </div>
                                        <div className="profile-info-item">
                                            <span className="profile-info-label">
                                                다음 갱신일
                                            </span>
                                            <strong>
                                                {formatDateLabel(planExpiryDate)}
                                            </strong>
                                            <p>
                                                정기 결제 또는 이용 만료 시점을
                                                안내합니다.
                                            </p>
                                        </div>
                                    </div>
                                </section>

                                <section className="profile-card">
                                    <div className="profile-card-head">
                                        <div>
                                            <h2>구독 및 사용량</h2>
                                            <p>
                                                플랜 상태와 토큰 사용량을 한 번에
                                                관리합니다.
                                            </p>
                                        </div>
                                        <span
                                            className={`profile-status-badge ${subscriptionStatusTone}`}
                                        >
                                            {subscriptionStatusLabel}
                                        </span>
                                    </div>

                                    <div className="profile-subscription-card">
                                        <div className="profile-subscription-top">
                                            <div className="profile-subscription-plan">
                                                <span
                                                    className={`profile-subscription-plan-icon ${effectivePlanId}`}
                                                >
                                                    {getPlanIcon(
                                                        isPlanResolving
                                                            ? undefined
                                                            : effectivePlanId,
                                                    )}
                                                </span>
                                                <div>
                                                    <span className="profile-subscription-plan-name">
                                                        {effectivePlanInfo.name}
                                                    </span>
                                                    <span className="profile-subscription-plan-desc">
                                                        {effectivePlanInfo.description}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="profile-subscription-expiry">
                                                <span className="profile-subscription-expiry-label">
                                                    만료일
                                                </span>
                                                <span className="profile-subscription-expiry-value">
                                                    {formatDateLabel(
                                                        planExpiryDate,
                                                    )}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="profile-subscription-meta-grid">
                                            <div className="profile-info-item compact">
                                                <span className="profile-info-label">
                                                    청구 시작일
                                                </span>
                                                <strong>
                                                    {formatDateLabel(
                                                        billingStartDate,
                                                    )}
                                                </strong>
                                            </div>
                                            <div className="profile-info-item compact">
                                                <span className="profile-info-label">
                                                    전체 토큰 한도
                                                </span>
                                                <strong>
                                                    {questionUsage
                                                        ? formatTokenCount(
                                                              questionUsage.limit,
                                                          )
                                                        : "-"}
                                                </strong>
                                            </div>
                                            <div className="profile-info-item compact">
                                                <span className="profile-info-label">
                                                    남은 토큰
                                                </span>
                                                <strong>
                                                    {formatTokenCount(
                                                        remainingQuestions,
                                                    )}
                                                </strong>
                                            </div>
                                        </div>

                                        <div className="profile-usage-block">
                                            <div className="profile-usage-head">
                                                <span>토큰 사용량</span>
                                                <strong>
                                                    {questionUsage
                                                        ? `${questionUsage.currentUsage.toLocaleString(
                                                              "ko-KR",
                                                          )} / ${questionUsage.limit.toLocaleString(
                                                              "ko-KR",
                                                          )} 토큰`
                                                        : "확인 중"}
                                                </strong>
                                            </div>
                                            <div className="profile-usage-track">
                                                <div
                                                    className={`profile-usage-fill ${
                                                        questionUsage &&
                                                        questionUsage.currentUsage >=
                                                            questionUsage.limit
                                                            ? "limit"
                                                            : ""
                                                    }`}
                                                    style={{
                                                        width: `${usageProgress}%`,
                                                    }}
                                                />
                                            </div>
                                            <div className="profile-usage-meta">
                                                <span>
                                                    사용{" "}
                                                    {questionUsage
                                                        ? formatTokenCount(
                                                              questionUsage.currentUsage,
                                                          )
                                                        : "-"}
                                                </span>
                                                <span>
                                                    남음{" "}
                                                    {formatTokenCount(
                                                        remainingQuestions,
                                                    )}
                                                </span>
                                            </div>
                                            {questionUsage &&
                                                questionUsage.currentUsage >=
                                                    questionUsage.limit && (
                                                    <p className="profile-usage-warning">
                                                        사용 한도에 도달했습니다.
                                                        플랜을 업그레이드해 계속
                                                        이용할 수 있습니다.
                                                    </p>
                                                )}
                                        </div>

                                        <div className="profile-subscription-actions">
                                            <button
                                                type="button"
                                                className="profile-btn profile-btn-upgrade"
                                                onClick={() =>
                                                    router.push("/pricing")
                                                }
                                            >
                                                요금제 보러가기
                                            </button>
                                            {effectivePlanId !== "free" &&
                                                (subscription?.status ===
                                                "cancelled" ? (
                                                    <div className="profile-subscription-cancelled">
                                                        <svg
                                                            width="16"
                                                            height="16"
                                                            viewBox="0 0 24 24"
                                                            fill="none"
                                                            stroke="currentColor"
                                                            strokeWidth="2"
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                        >
                                                            <circle
                                                                cx="12"
                                                                cy="12"
                                                                r="10"
                                                            />
                                                            <line
                                                                x1="12"
                                                                y1="8"
                                                                x2="12"
                                                                y2="12"
                                                            />
                                                            <line
                                                                x1="12"
                                                                y1="16"
                                                                x2="12.01"
                                                                y2="16"
                                                            />
                                                        </svg>
                                                        <span>
                                                            구독이 취소되어
                                                            만료일까지 이용할 수
                                                            있습니다.
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <div className="profile-cancel-sub-wrap">
                                                        <button
                                                            type="button"
                                                            className="profile-btn profile-btn-cancel-sub"
                                                            onClick={
                                                                handleCancelSubscription
                                                            }
                                                        >
                                                            구독 취소하기
                                                        </button>
                                                        <span className="profile-cancel-sub-tooltip">
                                                            다음 회차의 결제가
                                                            진행되지 않습니다.
                                                        </span>
                                                    </div>
                                                ))}
                                        </div>
                                    </div>
                                </section>

                                <section className="profile-card">
                                    <div className="profile-card-head">
                                        <div>
                                            <h2>보안 및 세션</h2>
                                            <p>
                                                비밀번호와 현재 로그인 상태를
                                                관리합니다.
                                            </p>
                                        </div>
                                    </div>

                                    <div className="profile-action-list">
                                        <div className="profile-action-row">
                                            <div className="profile-setting-info">
                                                <span className="profile-setting-label">
                                                    비밀번호 변경
                                                </span>
                                                <span className="profile-setting-desc">
                                                    계정 비밀번호를 새로
                                                    설정합니다.
                                                </span>
                                            </div>
                                            <button
                                                type="button"
                                                className="profile-btn profile-btn-secondary"
                                                onClick={() =>
                                                    router.push(
                                                        "/password-reset",
                                                    )
                                                }
                                            >
                                                변경하기
                                            </button>
                                        </div>

                                        <div className="profile-action-row">
                                            <div className="profile-setting-info">
                                                <span className="profile-setting-label">
                                                    로그아웃
                                                </span>
                                                <span className="profile-setting-desc">
                                                    현재 기기에서 안전하게
                                                    로그아웃합니다.
                                                </span>
                                            </div>
                                            <button
                                                type="button"
                                                className="profile-btn profile-btn-danger"
                                                onClick={handleLogout}
                                            >
                                                로그아웃
                                            </button>
                                        </div>
                                    </div>
                                </section>

                                <section className="profile-card profile-card-danger">
                                    <div className="danger-zone">
                                        <h2 className="danger-title">
                                            위험 영역
                                        </h2>
                                        <div className="danger-row">
                                            <div className="danger-info">
                                                <span className="danger-label">
                                                    계정 삭제
                                                </span>
                                                <span className="danger-desc">
                                                    계정과 저장된 데이터가
                                                    영구적으로 삭제됩니다.
                                                </span>
                                            </div>
                                            <div className="danger-actions">
                                                <button
                                                    type="button"
                                                    className="danger-btn danger-btn-secondary"
                                                    onClick={handleOpenUsageHistory}
                                                >
                                                    토큰 보기
                                                </button>
                                                <button
                                                    type="button"
                                                    className="danger-btn"
                                                    onClick={handleDeleteAccount}
                                                    disabled={deleting}
                                                >
                                                    {deleting
                                                        ? "삭제 중..."
                                                        : "계정 삭제"}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </section>
                            </div>
                        ) : (
                            <div className="profile-card-stack">
                                <section className="profile-card">
                                    <div className="profile-card-head">
                                        <div>
                                            <h2>결제 요약</h2>
                                            <p>
                                                현재 플랜과 결제 현황을 빠르게
                                                확인합니다.
                                            </p>
                                        </div>
                                        {effectivePlanId !== "free" && (
                                            <button
                                                type="button"
                                                className="profile-btn profile-btn-cancel-sub"
                                                onClick={handleCancelSubscription}
                                                disabled={
                                                    subscription?.status ===
                                                    "cancelled"
                                                }
                                            >
                                                {subscription?.status ===
                                                "cancelled"
                                                    ? "취소됨"
                                                    : "구독 취소"}
                                            </button>
                                        )}
                                    </div>

                                    <div className="profile-info-grid">
                                        <div className="profile-info-item">
                                            <span className="profile-info-label">
                                                현재 플랜
                                            </span>
                                            <strong>{effectivePlanInfo.name}</strong>
                                            <p>{effectivePlanInfo.description}</p>
                                        </div>
                                        <div className="profile-info-item">
                                            <span className="profile-info-label">
                                                청구 시작일
                                            </span>
                                            <strong>
                                                {formatDateLabel(
                                                    billingStartDate,
                                                )}
                                            </strong>
                                            <p>최초 또는 최근 갱신 기준입니다.</p>
                                        </div>
                                        <div className="profile-info-item">
                                            <span className="profile-info-label">
                                                다음 갱신일
                                            </span>
                                            <strong>
                                                {formatDateLabel(planExpiryDate)}
                                            </strong>
                                            <p>
                                                {subscriptionStatusLabel} 상태로
                                                표시됩니다.
                                            </p>
                                        </div>
                                    </div>
                                </section>

                                <section className="profile-card">
                                    <div className="profile-card-head">
                                        <div>
                                            <h2>결제 통계</h2>
                                            <p>
                                                결제 횟수와 누적 결제 금액을
                                                보여줍니다.
                                            </p>
                                        </div>
                                    </div>

                                    <div className="profile-info-grid">
                                        <div className="profile-info-item compact">
                                            <span className="profile-info-label">
                                                결제 완료
                                            </span>
                                            <strong>
                                                {completedPayments.length}건
                                            </strong>
                                        </div>
                                        <div className="profile-info-item compact">
                                            <span className="profile-info-label">
                                                누적 결제액
                                            </span>
                                            <strong>
                                                {totalPaidAmount > 0
                                                    ? formatCurrency(totalPaidAmount)
                                                    : "없음"}
                                            </strong>
                                        </div>
                                        <div className="profile-info-item compact">
                                            <span className="profile-info-label">
                                                남은 토큰
                                            </span>
                                            <strong>
                                                {formatTokenCount(
                                                    remainingQuestions,
                                                )}
                                            </strong>
                                        </div>
                                    </div>
                                </section>

                                <section className="profile-card">
                                    <div className="profile-card-head">
                                        <div>
                                            <h2>결제 내역</h2>
                                            <p>
                                                최근 결제와 환불 이력을 시간순으로
                                                확인합니다.
                                            </p>
                                        </div>
                                    </div>

                                    {loadingPayments ? (
                                        <div className="profile-empty-state">
                                            결제 정보를 불러오는 중입니다.
                                        </div>
                                    ) : paymentHistory.length === 0 ? (
                                        <div className="profile-empty-state">
                                            아직 결제 내역이 없습니다.
                                        </div>
                                    ) : (
                                        <div className="profile-payment-list">
                                            {paymentHistory.map((payment) => {
                                                const isRefunded =
                                                    String(
                                                        payment.status || "",
                                                    ).toUpperCase() ===
                                                    "REFUNDED";

                                                return (
                                                    <article
                                                        key={payment.paymentKey}
                                                        className="profile-payment-row"
                                                    >
                                                        <div className="profile-payment-main">
                                                            <div className="profile-payment-title-row">
                                                                <strong className="profile-payment-title">
                                                                    {
                                                                        payment.orderName
                                                                    }
                                                                </strong>
                                                                <span
                                                                    className={`profile-payment-status ${
                                                                        isRefunded
                                                                            ? "refunded"
                                                                            : "done"
                                                                    }`}
                                                                >
                                                                    {isRefunded
                                                                        ? "환불됨"
                                                                        : "결제 완료"}
                                                                </span>
                                                            </div>
                                                            <p className="profile-payment-meta">
                                                                {formatDateLabel(
                                                                    payment.approvedAt,
                                                                    true,
                                                                )}
                                                                {payment.card
                                                                    ?.company &&
                                                                    ` · ${payment.card.company}`}
                                                            </p>
                                                            <p className="profile-payment-meta">
                                                                주문번호{" "}
                                                                {payment.orderId ||
                                                                    payment.paymentKey}
                                                            </p>
                                                        </div>
                                                        <div className="profile-payment-side">
                                                            <strong
                                                                className={`profile-payment-amount ${
                                                                    isRefunded
                                                                        ? "refunded"
                                                                        : ""
                                                                }`}
                                                            >
                                                                {Number(
                                                                    payment.amount || 0,
                                                                ) > 0
                                                                    ? formatCurrency(
                                                                          Number(
                                                                              payment.amount ||
                                                                                  0,
                                                                          ),
                                                                      )
                                                                    : "없음"}
                                                            </strong>
                                                        </div>
                                                    </article>
                                                );
                                            })}
                                        </div>
                                    )}
                                </section>
                            </div>
                        )}
                    </section>
                </div>
            </main>

            {usageHistoryOpen && (
                <div
                    className="profile-modal-overlay"
                    onClick={() => setUsageHistoryOpen(false)}
                >
                    <div
                        className="profile-modal-card"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="profile-modal-head">
                            <div>
                                <h3>토큰 사용 이력</h3>
                                <p>최근에 어떤 AI 모델을 사용했고 얼마나 차감됐는지 확인합니다.</p>
                            </div>
                            <button
                                type="button"
                                className="profile-modal-close"
                                onClick={() => setUsageHistoryOpen(false)}
                            >
                                닫기
                            </button>
                        </div>

                        {loadingUsageHistory ? (
                            <div className="profile-empty-state">
                                토큰 사용 이력을 불러오는 중입니다.
                            </div>
                        ) : usageHistory.length === 0 ? (
                            <div className="profile-empty-state">
                                아직 기록된 토큰 사용 이력이 없습니다.
                            </div>
                        ) : (
                            <div className="profile-usage-history-list">
                                {usageHistory.map((log) => (
                                    <article
                                        key={log.id}
                                        className="profile-usage-history-row"
                                    >
                                        <div className="profile-usage-history-main">
                                            <strong className="profile-usage-history-title">
                                                {log.model || "알 수 없는 모델"}
                                            </strong>
                                            <p className="profile-usage-history-meta">
                                                {formatDateLabel(log.createdAt, true)}
                                                {log.feature ? ` · ${log.feature}` : ""}
                                                {log.source ? ` · ${log.source}` : ""}
                                            </p>
                                            <p className="profile-usage-history-meta">
                                                입력 {log.promptTokens.toLocaleString("ko-KR")} · 출력{" "}
                                                {log.outputTokens.toLocaleString("ko-KR")} 토큰
                                            </p>
                                        </div>
                                        <div className="profile-usage-history-side">
                                            <strong>
                                                {log.totalTokens.toLocaleString("ko-KR")} 토큰
                                            </strong>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            <Footer />
        </>
    );
}
