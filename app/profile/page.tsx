"use client";
import React, { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getAuth, deleteUser } from "firebase/auth";
import { getFirebaseAppOrNull } from "../../firebaseConfig";
import { getFirestore, doc, deleteDoc, getDoc } from "firebase/firestore";
import { loadTossPayments } from "@tosspayments/tosspayments-sdk";
import { useAuth } from "../../context/AuthContext";
import "./profile.css";
import "../style.css";
import "../mobile.css";

import { Navbar } from "../../components/Navbar";
import Footer from "../../components/Footer";
import Pricing from "../../components/Pricing";
import dynamic from "next/dynamic";
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
            { text: "총 5회 AI 타이핑 생성", included: true },
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
        monthlyPrice: 29900,
        yearlyPrice: 20930,
        icon: <ZapIcon />,
        popular: true,
        features: [
            { text: "월 300회+30회 AI 타이핑 생성", included: true },
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
        id: "pro",
        name: "Ultra 요금제",
        description: "모든 프리미엄 기능을 위한\n가장 강력한 플랜",
        monthlyPrice: 99000,
        yearlyPrice: 69300,
        icon: <CrownIcon />,
        features: [
            { text: "월 2000+200회 AI 타이핑 생성", included: true },
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

// Helper function to get tier order for comparison
function getTierOrder(planId: string): number {
    const tierOrder: { [key: string]: number } = {
        free: 0,
        go: 1,
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
            plus: "Plus 요금제로",
            pro: "Ultra 요금제로",
        };
        return `${planNames[planId]}<br />다운그레이드`;
    } else {
        // Upgrade
        const planNames: { [key: string]: string } = {
            free: "Free로",
            go: "Go 요금제로",
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
    const [activeTab, setActiveTab] = useState<
        "profile" | "subscription" | "payment"
    >("profile");
    const billingCycle: "yearly" = "yearly";
    const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<boolean>(false);
    const [subscription, setSubscription] = useState<any>(null);
    const [loadingSubscription, setLoadingSubscription] = useState(true);
    const [aiUsage, setAiUsage] = useState<{
        currentUsage: number;
        limit: number;
        plan: string;
    } | null>(null);
    const [paymentHistory, setPaymentHistory] = useState<any[]>([]);
    const [loadingPayments, setLoadingPayments] = useState(false);

    // Refresh key for forcing data reload
    const [refreshKey, setRefreshKey] = useState(0);

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
                if (plan === "pro" || plan === "ultra") return 2200;
                if (plan === "go") return 132;
                if (plan === "plus" || plan === "test") return 330;
                return 5;
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
                            const currentUsage = Number(
                                userData?.aiCallUsage ?? 0,
                            );
                            setAiUsage({
                                currentUsage: Number.isFinite(currentUsage)
                                    ? currentUsage
                                    : 0,
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
        if (
            tabParam === "subscription" ||
            tabParam === "payment" ||
            tabParam === "profile"
        ) {
            setActiveTab(tabParam);
            return;
        }

        // Then, check sessionStorage
        const savedTab = sessionStorage.getItem("profileTab");
        if (
            savedTab === "subscription" ||
            savedTab === "payment" ||
            savedTab === "profile"
        ) {
            setActiveTab(savedTab);
            sessionStorage.removeItem("profileTab");
        }
    }, [searchParams]);

    useEffect(() => {
        if (authUser) {
            setEmail(authUser.email || "");

            (async () => {
                try {
                    const firebaseApp = getFirebaseAppOrNull();
                    if (!firebaseApp) return;
                    const db = getFirestore(firebaseApp);
                    const docRef = doc(db, "users", authUser.uid);
                    const snap = await getDoc(docRef);
                    if (snap.exists()) {
                        const data = snap.data() as any;
                        if (data?.email) setEmail(data.email);
                    }
                } catch (err) {
                    console.warn("Failed to load profile from Firestore", err);
                }
            })();
        } else {
            setEmail("");
        }
    }, [authUser]);

    // 가격 포맷팅
    const formatPrice = (price: number) => {
        return price.toLocaleString("ko-KR");
    };

    // Map plan id to icon component
    const getPlanIcon = (planId?: string) => {
        if (planId === "pro") return <CrownIcon />;
        if (planId === "plus" || planId === "go") return <ZapIcon />;
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
    ): "free" | "go" | "plus" | "pro" => {
        if (typeof orderName !== "string") return "free";
        const normalized = orderName.toLowerCase();
        if (normalized.includes("ultra") || normalized.includes("pro")) return "pro";
        if (normalized.includes("go")) return "go";
        if (normalized.includes("plus")) return "plus";
        return "free";
    };

    const getEffectivePlanId = () => {
        const fromSubscription = normalizePlan(subscription?.plan);
        if (fromSubscription !== "free") return fromSubscription;

        const fromUsage = normalizePlan(aiUsage?.plan);
        if (fromUsage !== "free") return fromUsage;

        const latestPaid = paymentHistory.find((payment) => {
            const status = String(payment?.status || "").toUpperCase();
            return status === "DONE";
        });
        return inferPlanFromOrderName(latestPaid?.orderName);
    };

    const getPlanExpiryDate = () => {
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
            subscription?.billingStartDate ||
            subscription?.startDate ||
            subscription?.registeredAt ||
            subscription?.lastPaymentDate;

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
            return status === "DONE";
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

    const isPlanResolving = loadingSubscription || loadingPayments;
    const effectivePlanInfo = isPlanResolving
        ? {
              name: "요금제 확인 중",
              description: "결제 정보와 사용량을 동기화하고 있습니다",
          }
        : getPlanInfo(getEffectivePlanId());
    const planExpiryDate = getPlanExpiryDate();
    const fallbackLimitByPlan = (planId: string) => {
        const normalized = planId.toLowerCase();
        if (normalized === "pro" || normalized === "ultra") return 2200;
        if (normalized === "go") return 132;
        if (normalized === "plus" || normalized === "test") return 330;
        return 5;
    };
    const fallbackPlanId = getEffectivePlanId();
    const questionUsage =
        aiUsage ||
        (isPlanResolving
            ? null
            : {
                  currentUsage: 0,
                  limit: fallbackLimitByPlan(fallbackPlanId),
                  plan: fallbackPlanId,
              });

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
            // 결제 페이지로 리다이렉트 (단건 결제)
            const planNameMap: Record<string, string> = {
                go: "Go",
                plus: "Plus",
                pro: "Ultra",
            };
            const planName = planNameMap[plan.id] || plan.name;

            // 단건 결제는 월간 가격만 사용
            const planAmount = plan.monthlyPrice;

            window.location.href = `/payment?amount=${planAmount}&orderName=Nova AI ${planName} 요금제`;
        } catch (err: unknown) {
            console.error("결제 오류:", err);
            const error = err as { code?: string };
            if (error.code === "USER_CANCEL") {
                console.log("사용자가 결제를 취소했습니다.");
            } else {
                setError(
                    "결제 처리 중 오류가 발생했습니다. 다시 시도해주세요.",
                );
            }
        } finally {
            setLoadingPlan(null);
        }
    };

    // 구독 취소
    const handleCancelSubscription = async () => {
        if (!authUser || !subscription) return;

        if (
            !confirm(
                "구독을 취소하시겠습니까? 다음 결제일까지 서비스를 이용할 수 있습니다.",
            )
        ) {
            return;
        }

        try {
            // Call API to cancel billing key with TossPayments and update Firestore
            const response = await fetch("/api/billing/cancel", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
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
                isRecurring: false,
            });

            setStatus("구독이 취소되었습니다.");
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
            // 사용자 Firestore 데이터 삭제
            const db = getFirestore(firebaseApp);
            await deleteDoc(doc(db, "users", currentUser.uid));

            // Firebase Authentication에서 사용자 삭제
            await deleteUser(currentUser);

            setStatus("계정이 삭제되었습니다.");
            // 안전하게 홈으로 이동
            router.push("/");
        } catch (err: any) {
            console.error("Account deletion failed", err);
            if (err?.code === "auth/requires-recent-login") {
                setError("보안을 위해 최근 로그인 후 다시 시도해주세요.");
                // 세션을 종료하고 로그인 페이지로 이동
                try {
                    await logout();
                } catch {}
                sessionStorage.setItem("profileTab", "profile");
                router.push("/login");
            } else {
                setError(
                    "계정 삭제 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
                );
            }
        } finally {
            setDeleting(false);
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
                    {/* 사이드 네비게이션 */}
                    <aside className="profile-sidebar">
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
                                    activeTab === "subscription" ? "active" : ""
                                }`}
                                onClick={() => setActiveTab("subscription")}
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
                                    <rect
                                        x="2"
                                        y="5"
                                        width="20"
                                        height="14"
                                        rx="2"
                                    />
                                    <line x1="2" y1="10" x2="22" y2="10" />
                                </svg>
                                <span>요금제</span>
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
                    </aside>

                    {/* 메인 콘텐츠 */}
                    <section className="profile-main">
                        {/* Mobile top tabs: 프로필 / 요금제 / 계정 설정 */}
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
                                aria-selected={activeTab === "subscription"}
                                className={`profile-nav-item ${
                                    activeTab === "subscription" ? "active" : ""
                                }`}
                                onClick={() => setActiveTab("subscription")}
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
                                    <rect
                                        x="2"
                                        y="5"
                                        width="20"
                                        height="14"
                                        rx="2"
                                    />
                                    <line x1="2" y1="10" x2="22" y2="10" />
                                </svg>
                                <span>요금제</span>
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

                        {activeTab === "profile" ? (
                            <>
                                <div className="profile-form">
                                    <div className="profile-section">
                                        <h2 className="profile-section-title">
                                            기본 정보
                                        </h2>
                                        <div className="profile-field">
                                            <label className="profile-label">
                                                이메일
                                            </label>
                                            <input
                                                type="email"
                                                className="profile-input profile-input-disabled"
                                                value={email || ""}
                                                disabled
                                            />
                                            <p className="profile-hint">
                                                이메일은 변경할 수 없습니다
                                            </p>
                                        </div>
                                    </div>

                                    <div className="profile-section">
                                        <h2 className="profile-section-title">
                                            보안
                                        </h2>
                                        <div className="profile-setting-item">
                                            <div className="profile-setting-info">
                                                <span className="profile-setting-label">
                                                    비밀번호
                                                </span>
                                                <span className="profile-setting-desc">
                                                    계정 비밀번호를 변경합니다
                                                </span>
                                            </div>
                                            <button
                                                type="button"
                                                className="profile-btn profile-btn-secondary"
                                                onClick={() =>
                                                    (window.location.href =
                                                        "/password-reset")
                                                }
                                            >
                                                변경하기
                                            </button>
                                        </div>
                                    </div>

                                    <div className="profile-section">
                                        <h2 className="profile-section-title">
                                            세션
                                        </h2>
                                        <div className="profile-setting-item">
                                            <div className="profile-setting-info">
                                                <span className="profile-setting-label">
                                                    로그아웃
                                                </span>
                                                <span className="profile-setting-desc">
                                                    현재 기기에서 로그아웃합니다
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
                                                    계정과 모든 데이터가 영구적으로
                                                    삭제됩니다
                                                </span>
                                            </div>
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
                                </div>
                            </>
                        ) : activeTab === "subscription" ? (
                            <>
                                {/* 요금제 카드 */}
                                <div className="profile-form">
                                    <div className="profile-section profile-section--main-pricing">
                                        <Pricing />
                                    </div>
                                </div>

                                {/* 알림 메시지 */}
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
                                        <span>{error}</span>
                                    </div>
                                )}
                            </>
                        ) : activeTab === "payment" ? (
                            <>
                                {/* 현재 플랜 요약 */}
                                <div className="current-plan-card payment-flat-section">
                                    <div className="current-plan-header">
                                        <div className="current-plan-left">
                                            <div className="current-plan-text">
                                                <div className="current-plan-title">
                                                    <span className="current-plan-name">
                                                        {effectivePlanInfo.name}
                                                    </span>
                                                </div>

                                                <span className="current-plan-desc">
                                                    {effectivePlanInfo.description}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="current-plan-center">
                                            {(subscription?.billingStartDate ||
                                                subscription?.startDate) && (
                                                <div className="current-plan-center-item">
                                                    <span className="label">
                                                        청구 시작일
                                                    </span>
                                                    <span className="value">
                                                        {new Date(
                                                            subscription?.billingStartDate ||
                                                                subscription?.startDate,
                                                        ).toLocaleDateString(
                                                            "ko-KR",
                                                        )}
                                                    </span>
                                                </div>
                                            )}

                                            <div className="current-plan-center-item">
                                                <span className="label">
                                                    요금제 만료 시점
                                                </span>
                                                <span className="value">
                                                    {planExpiryDate
                                                        ? planExpiryDate.toLocaleDateString(
                                                              "ko-KR",
                                                          )
                                                        : "-"}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="current-plan-right">
                                            {subscription &&
                                                subscription.plan !==
                                                    "free" && (
                                                    <button
                                                        onClick={
                                                            handleCancelSubscription
                                                        }
                                                        className="current-plan-cancel-btn current-plan-cancel-outline"
                                                        disabled={
                                                            subscription.status ===
                                                            "cancelled"
                                                        }
                                                        aria-disabled={
                                                            subscription.status ===
                                                            "cancelled"
                                                        }
                                                    >
                                                        {subscription.status ===
                                                        "cancelled"
                                                            ? "취소됨"
                                                            : "구독 취소"}
                                                    </button>
                                                )}
                                        </div>
                                    </div>

                                    {/* Mobile-only stacked dates */}
                                    {(subscription ||
                                        subscription?.billingStartDate ||
                                        subscription?.nextBillingDate) && (
                                        <div
                                            className="current-plan-dates-mobile"
                                            aria-hidden={false}
                                        >
                                            {(subscription?.billingStartDate ||
                                                subscription?.startDate) && (
                                                <div className="current-plan-dates-item">
                                                    <span className="label">
                                                        청구 시작일
                                                    </span>
                                                    <span className="value">
                                                        {new Date(
                                                            subscription?.billingStartDate ||
                                                                subscription?.startDate,
                                                        ).toLocaleDateString(
                                                            "ko-KR",
                                                        )}
                                                    </span>
                                                </div>
                                            )}

                                            <div className="current-plan-dates-item">
                                                <span className="label">
                                                    요금제 만료 시점
                                                </span>
                                                <span className="value">
                                                    {planExpiryDate
                                                        ? planExpiryDate.toLocaleDateString(
                                                              "ko-KR",
                                                          )
                                                        : "-"}
                                                </span>
                                            </div>

                                            {subscription &&
                                                subscription.plan !==
                                                    "free" && (
                                                    <button
                                                        onClick={
                                                            handleCancelSubscription
                                                        }
                                                        className="current-plan-cancel-btn-mobile current-plan-cancel-outline"
                                                        aria-disabled={
                                                            subscription.status ===
                                                            "cancelled"
                                                        }
                                                        disabled={
                                                            subscription.status ===
                                                            "cancelled"
                                                        }
                                                    >
                                                        {subscription.status ===
                                                        "cancelled"
                                                            ? "취소됨"
                                                            : "구독 취소"}
                                                    </button>
                                                )}
                                        </div>
                                    )}

                                    <div className="current-plan-meta">
                                        <div className="current-plan-meta-item">
                                            <span className="label">
                                                요금제 만료 시점
                                            </span>
                                            <span className="value">
                                                {planExpiryDate
                                                    ? planExpiryDate.toLocaleDateString(
                                                          "ko-KR",
                                                      )
                                                    : "-"}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* AI Usage Stats */}
                                <div className="current-plan-card payment-flat-section">
                                        <div className="current-plan-header">
                                            <div className="current-plan-left">
                                                <div className="current-plan-icon usage">
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
                                                </div>
                                                <div className="current-plan-text">
                                                    <div className="current-plan-title">
                                                        <span className="current-plan-name">
                                                            AI 호출 사용량
                                                        </span>
                                                    </div>
                                                    <span className="current-plan-desc">
                                                        현재 질문수{" "}
                                                        <strong>
                                                            {questionUsage
                                                                ? questionUsage.currentUsage
                                                                : "-"}
                                                            회
                                                        </strong>{" "}
                                                        · 남은 질문수{" "}
                                                        <strong>
                                                            {questionUsage
                                                                ? Math.max(
                                                                      0,
                                                                      questionUsage.limit -
                                                                          questionUsage.currentUsage,
                                                                  )
                                                                : "-"}
                                                            회
                                                        </strong>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Usage Progress Bar */}
                                        <div
                                            style={{
                                                width: "100%",
                                                height: "6px",
                                                backgroundColor: "#1a1a1a",
                                                borderRadius: "3px",
                                                overflow: "hidden",
                                                marginTop: "1rem",
                                            }}
                                        >
                                            <div
                                                style={{
                                                    width: `${Math.min(
                                                        questionUsage
                                                            ? (questionUsage.currentUsage /
                                                                  Math.max(
                                                                      1,
                                                                      questionUsage.limit,
                                                                  )) *
                                                                  100
                                                            : 0,
                                                        100,
                                                    )}%`,
                                                    height: "100%",
                                                    backgroundColor:
                                                        questionUsage &&
                                                        questionUsage.currentUsage >=
                                                            questionUsage.limit
                                                            ? "#ef4444"
                                                            : "#3b82f6",
                                                    borderRadius: "3px",
                                                    transition:
                                                        "width 0.3s ease",
                                                }}
                                            />
                                        </div>

                                        {questionUsage &&
                                            questionUsage.currentUsage >=
                                                questionUsage.limit && (
                                            <p
                                                style={{
                                                    marginTop: "0.75rem",
                                                    color: "#ef4444",
                                                    fontSize: "13px",
                                                    fontWeight: "500",
                                                }}
                                            >
                                                사용 한도에 도달했습니다. 플랜을
                                                업그레이드하여 계속 이용하세요.
                                            </p>
                                        )}
                                    </div>

                                {/* Payment History */}
                                <div className="current-plan-card payment-flat-section">
                                    <div className="current-plan-header">
                                        <div className="current-plan-left">
                                            <div className="current-plan-text">
                                                <div className="current-plan-title">
                                                    <span className="current-plan-name">
                                                        결제 내역
                                                    </span>
                                                </div>
                                                <span className="current-plan-desc">
                                                    최근 결제 내역
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    <div
                                        style={{
                                            display: "flex",
                                            gap: "1.25rem",
                                            marginTop: "1rem",
                                            paddingTop: "1rem",
                                            borderTop: "1px solid #1a1a1a",
                                            flexWrap: "wrap",
                                        }}
                                    >
                                        <p
                                            style={{
                                                margin: 0,
                                                fontSize: "0.875rem",
                                                color: "#a1a1aa",
                                            }}
                                        >
                                            현재 질문수:{" "}
                                            <strong style={{ color: "#eee" }}>
                                                {questionUsage
                                                    ? `${questionUsage.currentUsage}회`
                                                    : "-"}
                                            </strong>
                                        </p>
                                        <p
                                            style={{
                                                margin: 0,
                                                fontSize: "0.875rem",
                                                color: "#a1a1aa",
                                            }}
                                        >
                                            남은 질문수:{" "}
                                            <strong style={{ color: "#22c55e" }}>
                                                {questionUsage
                                                    ? `${Math.max(
                                                          0,
                                                          questionUsage.limit -
                                                              questionUsage.currentUsage,
                                                      )}회`
                                                    : "-"}
                                            </strong>
                                        </p>
                                    </div>

                                    {loadingPayments ? (
                                        <p
                                            style={{
                                                padding: "1rem 0",
                                                color: "#555",
                                                fontSize: "0.875rem",
                                            }}
                                        >
                                            로딩 중...
                                        </p>
                                    ) : paymentHistory.length === 0 ? (
                                        <p
                                            style={{
                                                padding: "1rem 0",
                                                color: "#555",
                                                fontSize: "0.875rem",
                                            }}
                                        >
                                            결제 내역이 없습니다.
                                        </p>
                                    ) : (
                                        <div style={{ marginTop: "1rem" }}>
                                            {paymentHistory.map((payment) => (
                                                <div
                                                    key={payment.paymentKey}
                                                    style={{
                                                        display: "flex",
                                                        justifyContent:
                                                            "space-between",
                                                        alignItems: "center",
                                                        padding: "12px 0",
                                                        borderBottom:
                                                            "1px solid #1a1a1a",
                                                    }}
                                                >
                                                    <div>
                                                        <p
                                                            style={{
                                                                fontWeight: 500,
                                                                marginBottom:
                                                                    "4px",
                                                                color: "#eee",
                                                                fontSize:
                                                                    "0.875rem",
                                                            }}
                                                        >
                                                            {payment.orderName}
                                                        </p>
                                                        <p
                                                            style={{
                                                                fontSize:
                                                                    "0.8125rem",
                                                                color: "#555",
                                                            }}
                                                        >
                                                            결제 코드:{" "}
                                                            {payment.orderId ||
                                                                payment.paymentKey}
                                                        </p>
                                                        <p
                                                            style={{
                                                                fontSize:
                                                                    "0.8125rem",
                                                                color: "#555",
                                                            }}
                                                        >
                                                            {new Date(
                                                                payment.approvedAt,
                                                            ).toLocaleDateString(
                                                                "ko-KR",
                                                                {
                                                                    year: "numeric",
                                                                    month: "long",
                                                                    day: "numeric",
                                                                },
                                                            )}{" "}
                                                            {new Date(
                                                                payment.approvedAt,
                                                            ).toLocaleTimeString(
                                                                "ko-KR",
                                                                {
                                                                    hour: "2-digit",
                                                                    minute: "2-digit",
                                                                },
                                                            )}
                                                            {payment.card
                                                                ?.company &&
                                                                ` · ${payment.card.company}`}
                                                        </p>
                                                    </div>
                                                    <div
                                                        style={{
                                                            textAlign: "right",
                                                        }}
                                                    >
                                                        <p
                                                            style={{
                                                                fontWeight: 600,
                                                                marginBottom:
                                                                    "4px",
                                                                fontSize:
                                                                    "0.875rem",
                                                                color:
                                                                    payment.status ===
                                                                    "REFUNDED"
                                                                        ? "#ef4444"
                                                                        : "#eee",
                                                            }}
                                                        >
                                                            {payment.status ===
                                                            "REFUNDED" ? (
                                                                <span
                                                                    style={{
                                                                        textDecoration:
                                                                            "line-through",
                                                                    }}
                                                                >
                                                                    {payment.amount?.toLocaleString()}
                                                                    원
                                                                </span>
                                                            ) : (
                                                                `${payment.amount?.toLocaleString()}원`
                                                            )}
                                                        </p>
                                                        {payment.status ===
                                                        "REFUNDED" ? (
                                                            <span
                                                                style={{
                                                                    fontSize:
                                                                        "12px",
                                                                    color: "#ef4444",
                                                                    fontWeight: 500,
                                                                }}
                                                            >
                                                                환불됨
                                                            </span>
                                                        ) : (
                                                            <span
                                                                style={{
                                                                    fontSize:
                                                                        "12px",
                                                                    color: "#22c55e",
                                                                    fontWeight: 500,
                                                                }}
                                                            >
                                                                결제 완료
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* 알림 메시지 */}
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
                            </>
                        ) : null}
                    </section>
                </div>
            </main>

            <Footer />
        </>
    );
}
