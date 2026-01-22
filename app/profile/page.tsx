"use client";
import React, { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getAuth, updateProfile, deleteUser } from "firebase/auth";
import { app } from "../../firebaseConfig";
import { getFirestore, doc, deleteDoc, getDoc } from "firebase/firestore";
import { loadTossPayments } from "@tosspayments/tosspayments-sdk";
import { useAuth } from "../../context/AuthContext";
import "./profile.css";
import "../style.css";
import "../mobile.css";

import { Navbar } from "../../components/Navbar";
import Footer from "../../components/Footer";
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
        name: "무료",
        description: "Nova AI를 처음 시작하는\n분들을 위한 가장 간단한 플랜",
        monthlyPrice: 0,
        yearlyPrice: 0,
        icon: <SparklesIcon />,
        features: [
            { text: "하루 10회 AI 생성", included: true },
            { text: "기본 수식 자동화", included: true },
            { text: "광고 없는 경험", included: true },
            { text: "커뮤니티 지원", included: true },
            { text: "AI 최적화 기능", included: false },
            { text: "코드 저장 & 관리", included: false },
        ],
        ctaText: "현재 플랜",
    },
    {
        id: "basic",
        name: "베이직",
        description: "전문적인 한글 문서 자동화를\n시작해보세요",
        monthlyPrice: 9900,
        yearlyPrice: 7900,
        icon: <ZapIcon />,
        popular: false,
        features: [
            { text: "제한된 AI 생성", included: true },
            { text: "모든 수식 자동화", included: true },
            { text: "코드 저장 & 관리", included: true },
            { text: "우선 지원 서비스", included: true },
            { text: "AI 최적화 기능", included: true },
            { text: "API 액세스", included: false },
        ],
        ctaText: "베이직으로 업그레이드",
    },
    {
        id: "plus",
        name: "플러스",
        description: "더 많은 기능과\n우선 지원을 받으세요",
        monthlyPrice: 19900,
        yearlyPrice: 15900,
        icon: <ZapIcon />,
        popular: true,
        features: [
            { text: "베이직 모든 기능", included: true },
            { text: "고급 AI 모델", included: true },
            { text: "팀 공유 기능", included: true },
            { text: "우선 지원 서비스", included: true },
            { text: "월 1회 1:1 컨설팅", included: true },
            { text: "API 액세스", included: false },
        ],
        ctaText: "플러스로 업그레이드",
    },
    {
        id: "pro",
        name: "프로",
        description: "모든 프리미엄 기능을 위한\n가장 강력한 플랜",
        monthlyPrice: 29900,
        yearlyPrice: 23900,
        icon: <CrownIcon />,
        features: [
            { text: "무제한 모든 기능", included: true },
            { text: "팀 협업 기능", included: true },
            { text: "API 액세스", included: true },
            { text: "전담 지원 서비스", included: true },
            { text: "최우선 업데이트", included: true },
            { text: "맞춤형 기능 요청", included: true },
        ],
        ctaText: "프로로 업그레이드",
    },
];

// Helper function to get tier order for comparison
function getTierOrder(planId: string): number {
    const tierOrder: { [key: string]: number } = {
        free: 0,
        basic: 1,
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
            free: "무료로",
            basic: "베이직으로",
            plus: "플러스로",
            pro: "프로로",
        };
        return `${planNames[planId]}<br />다운그레이드`;
    } else {
        // Upgrade
        const planNames: { [key: string]: string } = {
            free: "무료로",
            basic: "베이직으로",
            plus: "플러스로",
            pro: "프로로",
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
        avatar: authAvatar,
        updateAvatar,
        logout,
    } = useAuth();

    const [displayName, setDisplayName] = useState("");
    const [email, setEmail] = useState("");
    const [preview, setPreview] = useState<string | null>(null);
    const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
    const [removingPhoto, setRemovingPhoto] = useState(false);
    const [processingImage, setProcessingImage] = useState(false);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<
        "profile" | "subscription" | "account"
    >("profile");
    const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">(
        "monthly"
    );
    const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<boolean>(false);
    const [subscription, setSubscription] = useState<any>(null);
    const [loadingSubscription, setLoadingSubscription] = useState(true);
    const [aiUsage, setAiUsage] = useState<{
        currentUsage: number;
        limit: number;
        plan: string;
    } | null>(null);

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

            try {
                const response = await fetch(
                    `/api/ai/check-limit?userId=${authUser.uid}`
                );
                if (response.ok) {
                    const data = await response.json();
                    setAiUsage({
                        currentUsage: data.currentUsage,
                        limit: data.limit,
                        plan: data.plan,
                    });
                }
            } catch (error) {
                console.error("Failed to load AI usage:", error);
            }
        }

        loadAiUsage();
    }, [authUser, subscription?.plan, refreshKey]);

    // Check for tab query parameter and sessionStorage
    useEffect(() => {
        // First, check URL query parameter
        const tabParam = searchParams?.get("tab");
        if (
            tabParam === "subscription" ||
            tabParam === "account" ||
            tabParam === "profile"
        ) {
            setActiveTab(tabParam);
            return;
        }

        // Then, check sessionStorage
        const savedTab = sessionStorage.getItem("profileTab");
        if (
            savedTab === "subscription" ||
            savedTab === "account" ||
            savedTab === "profile"
        ) {
            setActiveTab(savedTab);
            sessionStorage.removeItem("profileTab");
        }
    }, [searchParams]);

    useEffect(() => {
        if (authUser) {
            // Start with Auth-provided values (fast) then overwrite with Firestore values if present
            setEmail(authUser.email || "");
            setDisplayName(authUser.displayName || "");
            setPreview(authAvatar || null);
            setPhotoDataUrl(null);
            setRemovingPhoto(false);

            // Always try to read the Firestore user doc and prefer its fields when available
            (async () => {
                try {
                    const db = getFirestore(app);
                    const docRef = doc(db, "users", authUser.uid);
                    const snap = await getDoc(docRef);
                    if (snap.exists()) {
                        const data = snap.data() as any;
                        if (data?.email) setEmail(data.email);
                        if (data?.displayName) setDisplayName(data.displayName);
                        if (data?.avatar) setPreview(data.avatar);
                    }
                } catch (err) {
                    console.warn("Failed to load profile from Firestore", err);
                }
            })();
        } else {
            setEmail("");
            setDisplayName("");
            setPreview(null);
            setPhotoDataUrl(null);
            setRemovingPhoto(false);
        }
    }, [authUser, authAvatar]);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const fileToDataUrl = (file: File): Promise<string> =>
        new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result as string;
                const img = new Image();
                img.onload = () => {
                    try {
                        const maxDim = 384;
                        let { width, height } = img;
                        if (width > maxDim || height > maxDim) {
                            const ratio = width / height;
                            if (ratio > 1) {
                                width = maxDim;
                                height = Math.round(maxDim / ratio);
                            } else {
                                height = maxDim;
                                width = Math.round(maxDim * ratio);
                            }
                        }
                        const canvas = document.createElement("canvas");
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext("2d");
                        if (!ctx) throw new Error("Cannot get canvas context");
                        ctx.drawImage(img, 0, 0, width, height);
                        const compressed = canvas.toDataURL("image/jpeg", 0.6);
                        const dataUrl =
                            compressed.length < result.length
                                ? compressed
                                : result;
                        resolve(dataUrl);
                    } catch (err) {
                        resolve(result);
                    }
                };
                img.onerror = () => reject(new Error("Image load error"));
                img.src = result;
            };
            reader.onerror = () => reject(new Error("File read error"));
            reader.readAsDataURL(file);
        });

    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setError(null);
        setStatus(null);
        setProcessingImage(true);
        try {
            const dataUrl = await fileToDataUrl(file);
            if (dataUrl.length > 800_000) {
                setError(
                    "이미지 크기가 너무 큽니다. 더 작은 이미지를 사용해주세요 (약 800KB 이하 권장)."
                );
                setProcessingImage(false);
                return;
            }
            setPreview(dataUrl);
            setPhotoDataUrl(dataUrl);
            setRemovingPhoto(false);
        } catch (err) {
            console.error(err);
            setError("이미지를 처리하지 못했습니다.");
        } finally {
            setProcessingImage(false);
            if (e.target) e.target.value = "";
        }
    };

    const handleClearPhoto = () => {
        setPhotoDataUrl(null);
        setPreview(null);
        setRemovingPhoto(true);
    };

    const handleSubmit = (ev: React.FormEvent) => {
        ev.preventDefault();
        if (processingImage) {
            setError("이미지 처리가 완료될 때까지 기다려 주세요.");
            return;
        }
        setSaving(true);
        setError(null);
        setStatus(null);

        if (!authUser) {
            setError("Not authenticated");
            setSaving(false);
            return;
        }

        router.push("/");

        (async () => {
            try {
                const auth = getAuth();
                if (auth.currentUser) {
                    try {
                        await updateProfile(auth.currentUser, { displayName });
                        await auth.currentUser.reload();
                        try {
                            setDisplayName(auth.currentUser.displayName || "");
                        } catch {}
                    } catch (err) {
                        console.error(
                            "Failed to update displayName (background)",
                            err
                        );
                    }
                }

                try {
                    await updateAvatar(removingPhoto ? null : photoDataUrl);
                } catch (err) {
                    console.error("Failed to update avatar (background)", err);
                }
            } catch (err) {
                console.error("Profile background save failed", err);
            }
        })();

        setSaving(false);
        setStatus("프로필이 업데이트되었습니다.");
    };

    const initial = (displayName || email || "U")
        .trim()
        .charAt(0)
        .toUpperCase();

    // 가격 포맷팅
    const formatPrice = (price: number) => {
        return price.toLocaleString("ko-KR");
    };

    // Map plan id to icon component
    const getPlanIcon = (planId?: string) => {
        if (planId === "pro") return <CrownIcon />;
        if (planId === "plus") return <ZapIcon />;
        if (planId === "basic") return <ZapIcon />;
        return <SparklesIcon />;
    };

    // Get plan display info
    const getPlanInfo = (planId?: string) => {
        const plan = planId || "free";
        const planMap: Record<string, { name: string; description: string }> = {
            pro: {
                name: "프로 플랜",
                description: "모든 프리미엄 기능을 이용 중입니다",
            },
            plus: {
                name: "플러스 플랜",
                description: "전문 기능을 이용 중입니다",
            },
            basic: {
                name: "베이직 플랜",
                description: "베이직 기능을 이용 중입니다",
            },
            free: {
                name: "무료 플랜",
                description: "기본 기능을 이용 중입니다",
            },
        };
        return planMap[plan] || planMap.free;
    };

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
                    ? "무료 플랜으로 다운그레이드하시겠습니까? 프리미엄 기능을 더 이상 사용할 수 없습니다."
                    : `${plan.name} 플랜으로 다운그레이드하시겠습니까? 일부 기능이 제한됩니다.`;
            
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

                setStatus(`${plan.name} 플랜으로 변경되었습니다.`);
                setTimeout(() => setStatus(null), 3000);
            } catch (err) {
                console.error("플랜 변경 오류:", err);
                setError(
                    err instanceof Error
                        ? err.message
                        : "플랜 변경 중 오류가 발생했습니다. 다시 시도해주세요."
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
            // 결제 페이지로 리다이렉트
            const planNameMap: Record<string, string> = {
                basic: "베이직",
                plus: "플러스",
                pro: "프로",
            };
            const planName = planNameMap[plan.id] || plan.name;
            
            // compute amount based on billing cycle
            const planAmount =
                billingCycle === "monthly"
                    ? plan.monthlyPrice
                    : plan.yearlyPrice * 12;

            window.location.href = `/payment?amount=${planAmount}&orderName=Nova AI ${planName} 요금제&recurring=true&billingCycle=${billingCycle}`;
        } catch (err: unknown) {
            console.error("결제 오류:", err);
            const error = err as { code?: string };
            if (error.code === "USER_CANCEL") {
                console.log("사용자가 결제를 취소했습니다.");
            } else {
                setError(
                    "결제 처리 중 오류가 발생했습니다. 다시 시도해주세요."
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
                "구독을 취소하시겠습니까? 다음 결제일까지 서비스를 이용할 수 있습니다."
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
            setError(error?.message || "구독 취소에 실패했습니다. 다시 시도해주세요.");
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
                      "정말로 계정을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다."
                  )
                : true;
        if (!confirmed) return;

        const auth = getAuth(app);
        const currentUser = auth.currentUser;
        if (!currentUser) {
            setError("계정을 삭제하려면 로그인이 필요합니다.");
            return;
        }

        setDeleting(true);
        try {
            // 사용자 Firestore 데이터 삭제
            const db = getFirestore(app);
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
                sessionStorage.setItem("profileTab", "account");
                router.push("/login");
            } else {
                setError(
                    "계정 삭제 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
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
                                    activeTab === "account" ? "active" : ""
                                }`}
                                onClick={() => setActiveTab("account")}
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
                                    <circle cx="12" cy="12" r="3" />
                                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                                </svg>
                                <span>계정 설정</span>
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
                                aria-selected={activeTab === "account"}
                                className={`profile-nav-item ${
                                    activeTab === "account" ? "active" : ""
                                }`}
                                onClick={() => setActiveTab("account")}
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
                                    <circle cx="12" cy="12" r="3" />
                                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1z" />
                                </svg>
                                <span>계정 설정</span>
                            </button>
                        </nav>

                        {activeTab === "profile" ? (
                            <>
                                <header className="profile-section-header">
                                    <h1 className="profile-title">프로필</h1>
                                    <p className="profile-subtitle">
                                        회원 정보를 관리하세요
                                    </p>
                                </header>

                                <form
                                    className="profile-form"
                                    onSubmit={handleSubmit}
                                >
                                    {/* 아바타 섹션 */}
                                    <div className="profile-section">
                                        <h2 className="profile-section-title">
                                            프로필 사진
                                        </h2>
                                        <div className="profile-avatar-area">
                                            <div className="profile-avatar-wrapper">
                                                {preview ? (
                                                    <img
                                                        src={preview}
                                                        alt="프로필 사진"
                                                        className="profile-avatar-img"
                                                    />
                                                ) : (
                                                    <div className="profile-avatar-placeholder">
                                                        {initial}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="profile-avatar-actions">
                                                <label className="profile-btn profile-btn-secondary">
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
                                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                                        <polyline points="17 8 12 3 7 8" />
                                                        <line
                                                            x1="12"
                                                            y1="3"
                                                            x2="12"
                                                            y2="15"
                                                        />
                                                    </svg>
                                                    <span>사진 업로드</span>
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        onChange={handleFile}
                                                        ref={fileInputRef}
                                                        disabled={
                                                            processingImage ||
                                                            saving
                                                        }
                                                        hidden
                                                    />
                                                </label>
                                                {preview && (
                                                    <button
                                                        type="button"
                                                        className="profile-btn profile-btn-ghost"
                                                        onClick={
                                                            handleClearPhoto
                                                        }
                                                    >
                                                        삭제
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <p className="profile-hint">
                                            JPG, PNG, GIF 형식 / 최대 800KB
                                        </p>
                                    </div>

                                    {/* 기본 정보 섹션 */}
                                    <div className="profile-section">
                                        <h2 className="profile-section-title">
                                            기본 정보
                                        </h2>

                                        <div className="profile-field">
                                            <label className="profile-label">
                                                표시 이름
                                            </label>
                                            <input
                                                type="text"
                                                className="profile-input"
                                                value={displayName}
                                                onChange={(e) =>
                                                    setDisplayName(
                                                        e.target.value
                                                    )
                                                }
                                                placeholder="이름을 입력하세요"
                                            />
                                        </div>

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

                                    {/* 저장 버튼 */}
                                    <div className="profile-actions">
                                        <button
                                            type="submit"
                                            className="profile-btn profile-btn-primary profile-btn-save"
                                            disabled={saving || processingImage}
                                        >
                                            {saving
                                                ? "저장 중..."
                                                : processingImage
                                                ? "이미지 처리 중..."
                                                : "변경 사항 저장"}
                                        </button>
                                    </div>
                                </form>
                            </>
                        ) : activeTab === "subscription" ? (
                            <>
                                <header className="profile-section-header">
                                    <h1 className="profile-title">요금제</h1>
                                    <p className="profile-subtitle">
                                        플랜을 선택하고 구독을 관리하세요
                                    </p>
                                </header>

                                <div className="current-plan-card">
                                    <div className="current-plan-header">
                                        <div className="current-plan-left">
                                            <div
                                                className={`current-plan-icon ${subscription?.plan}`}
                                            >
                                                {getPlanIcon(
                                                    subscription?.plan
                                                )}
                                            </div>

                                            <div className="current-plan-text">
                                                <div className="current-plan-title">
                                                    <span className="current-plan-name">
                                                        {getPlanInfo(subscription?.plan).name}
                                                    </span>
                                                </div>

                                                <span className="current-plan-desc">
                                                    {getPlanInfo(subscription?.plan).description}
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
                                                                subscription?.startDate
                                                        ).toLocaleDateString(
                                                            "ko-KR"
                                                        )}
                                                    </span>
                                                </div>
                                            )}

                                            <div className="current-plan-center-item">
                                                <span className="label">
                                                    다음 결제일
                                                </span>
                                                <span className="value">
                                                    {subscription?.nextBillingDate
                                                        ? new Date(
                                                              subscription.nextBillingDate
                                                          ).toLocaleDateString(
                                                              "ko-KR"
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

                                    {/* Mobile-only stacked dates: placed under the plan on small screens */}
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
                                                                subscription?.startDate
                                                        ).toLocaleDateString(
                                                            "ko-KR"
                                                        )}
                                                    </span>
                                                </div>
                                            )}

                                            <div className="current-plan-dates-item">
                                                <span className="label">
                                                    다음 결제일
                                                </span>
                                                <span className="value">
                                                    {subscription?.nextBillingDate
                                                        ? new Date(
                                                              subscription.nextBillingDate
                                                          ).toLocaleDateString(
                                                              "ko-KR"
                                                          )
                                                        : "-"}
                                                </span>
                                            </div>

                                            {/* Mobile-only cancel button inside dates row */}
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
                                                다음 결제일
                                            </span>
                                            <span className="value">
                                                {subscription?.nextBillingDate
                                                    ? new Date(
                                                          subscription.nextBillingDate
                                                      ).toLocaleDateString(
                                                          "ko-KR"
                                                      )
                                                    : "-"}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* AI Usage Stats */}
                                {aiUsage && (
                                    <div
                                        className="current-plan-card"
                                        style={{ marginTop: "2rem" }}
                                    >
                                        <div className="current-plan-header">
                                            <div className="current-plan-left">
                                                <div className="current-plan-icon usage">
                                                    <svg
                                                        width="24"
                                                        height="24"
                                                        viewBox="0 0 24 24"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        strokeWidth="2"
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                    >
                                                        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                                                    </svg>
                                                </div>
                                                <div className="current-plan-text">
                                                    <div className="current-plan-title">
                                                        <span className="current-plan-name">
                                                            AI 호출 사용량
                                                        </span>
                                                    </div>
                                                    <span className="current-plan-desc">
                                                        {aiUsage.currentUsage} /{" "}
                                                        {aiUsage.limit} 회 사용
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Usage Progress Bar */}
                                        <div
                                            style={{
                                                width: "100%",
                                                height: "8px",
                                                backgroundColor: "#f3f4f6",
                                                borderRadius: "4px",
                                                overflow: "hidden",
                                                marginTop: "1rem",
                                            }}
                                        >
                                            <div
                                                style={{
                                                    width: `${Math.min(
                                                        (aiUsage.currentUsage /
                                                            aiUsage.limit) *
                                                            100,
                                                        100
                                                    )}%`,
                                                    height: "100%",
                                                    backgroundColor:
                                                        aiUsage.currentUsage >=
                                                        aiUsage.limit
                                                            ? "#ef4444"
                                                            : "#3b82f6",
                                                    transition:
                                                        "width 0.3s ease",
                                                }}
                                            />
                                        </div>

                                        {aiUsage.currentUsage >=
                                            aiUsage.limit && (
                                            <p
                                                style={{
                                                    marginTop: "1rem",
                                                    color: "#ef4444",
                                                    fontSize: "14px",
                                                    fontWeight: "500",
                                                }}
                                            >
                                                사용 한도에 도달했습니다. 플랜을
                                                업그레이드하여 계속 이용하세요.
                                            </p>
                                        )}
                                    </div>
                                )}

                                <div className="profile-form">
                                    {/* 결제 주기 선택 */}
                                    <div className="profile-section">
                                        <h2 className="profile-section-title">
                                            결제 주기
                                        </h2>
                                        <div className="profile-billing-toggle">
                                            <button
                                                className={`profile-billing-option ${
                                                    billingCycle === "monthly"
                                                        ? "active"
                                                        : ""
                                                }`}
                                                onClick={() =>
                                                    setBillingCycle("monthly")
                                                }
                                            >
                                                월간 결제
                                            </button>
                                            <button
                                                className={`profile-billing-option ${
                                                    billingCycle === "yearly"
                                                        ? "active"
                                                        : ""
                                                }`}
                                                onClick={() =>
                                                    setBillingCycle("yearly")
                                                }
                                            >
                                                연간 결제
                                                <span className="profile-billing-discount">
                                                    20% 할인
                                                </span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* 플랜 목록 */}
                                    <div className="profile-section">
                                        <h2 className="profile-section-title">
                                            플랜 선택
                                        </h2>
                                        <div className="profile-plans-grid">
                                            {plansData.map((plan) => {
                                                const price =
                                                    billingCycle === "monthly"
                                                        ? plan.monthlyPrice
                                                        : plan.yearlyPrice;
                                                const currentPlanId = subscription?.plan || "free";
                                                const isCurrentPlan =
                                                    subscription?.plan
                                                        ? subscription.plan ===
                                                          plan.id
                                                        : plan.id === "free";
                                                const ctaText = isCurrentPlan 
                                                    ? "현재 플랜" 
                                                    : getCtaText(plan.id, currentPlanId);

                                                return (
                                                    <div
                                                        key={plan.id}
                                                        className={`profile-plan-item ${
                                                            plan.popular
                                                                ? "popular"
                                                                : ""
                                                        } ${
                                                            isCurrentPlan
                                                                ? "current"
                                                                : ""
                                                        }`}
                                                    >
                                                        {plan.popular && (
                                                            <span className="profile-plan-popular-badge">
                                                                BEST
                                                            </span>
                                                        )}

                                                        <div className="profile-plan-item-header">
                                                            <div className="profile-plan-item-icon">
                                                                {plan.icon}
                                                            </div>
                                                            <div className="profile-plan-item-title">
                                                                <span className="profile-plan-item-name">
                                                                    {plan.name}
                                                                </span>
                                                                <span className="profile-plan-item-desc">
                                                                    {
                                                                        plan.description
                                                                    }
                                                                </span>
                                                            </div>
                                                        </div>

                                                        <div className="profile-plan-item-price">
                                                            <span className="profile-plan-item-currency">
                                                                ₩
                                                            </span>
                                                            <span className="profile-plan-item-amount">
                                                                {formatPrice(
                                                                    price
                                                                )}
                                                            </span>
                                                            <span className="profile-plan-item-period">
                                                                /월
                                                            </span>
                                                        </div>

                                                        {billingCycle ===
                                                            "yearly" &&
                                                            plan.monthlyPrice >
                                                                0 && (
                                                                <div className="profile-plan-item-yearly">
                                                                    연간 ₩
                                                                    {formatPrice(
                                                                        price *
                                                                            12
                                                                    )}{" "}
                                                                    결제
                                                                </div>
                                                            )}

                                                        <ul className="profile-plan-item-features">
                                                            {plan.features.map(
                                                                (
                                                                    feature,
                                                                    index
                                                                ) => (
                                                                    <li
                                                                        key={
                                                                            index
                                                                        }
                                                                        className={`profile-plan-item-feature ${
                                                                            !feature.included
                                                                                ? "disabled"
                                                                                : ""
                                                                        }`}
                                                                    >
                                                                        {feature.included ? (
                                                                            <CheckIcon />
                                                                        ) : (
                                                                            <XIcon />
                                                                        )}
                                                                        <span>
                                                                            {
                                                                                feature.text
                                                                            }
                                                                        </span>
                                                                    </li>
                                                                )
                                                            )}
                                                        </ul>

                                                        <button
                                                            className={`profile-btn ${
                                                                isCurrentPlan
                                                                    ? "profile-btn-secondary"
                                                                    : plan.popular
                                                                    ? "profile-btn-primary"
                                                                    : "profile-btn-secondary"
                                                            } profile-plan-item-btn`}
                                                            onClick={() =>
                                                                handleSubscribe(
                                                                    plan
                                                                )
                                                            }
                                                            disabled={
                                                                isCurrentPlan ||
                                                                loadingPlan ===
                                                                    plan.id
                                                            }
                                                        >
                                                            {loadingPlan ===
                                                            plan.id ? (
                                                                <>
                                                                    <span className="profile-loading-spinner"></span>
                                                                    처리 중...
                                                                </>
                                                            ) : isCurrentPlan ? (
                                                                "현재 플랜"
                                                            ) : (
                                                                <span dangerouslySetInnerHTML={{ __html: ctaText }} />
                                                            )}
                                                        </button>
                                                    </div>
                                                );
                                            })}
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

                                    {/* 안내 문구 */}
                                    <div className="profile-subscription-note">
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
                                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                            <path d="m9 12 2 2 4-4" />
                                        </svg>
                                        <span>
                                            7일 이내 환불 보장 · 언제든지 취소
                                            가능
                                        </span>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <>
                                <header className="profile-section-header">
                                    <h1 className="profile-title">계정 설정</h1>
                                    <p className="profile-subtitle">
                                        계정 보안 및 접근 권한을 관리하세요
                                    </p>
                                </header>

                                <div className="profile-form">
                                    {/* 보안 섹션 */}
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

                                    {/* 세션 관리 */}
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

                                    {/* 위험 영역 (new minimal design) */}
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
                                                    계정과 모든 데이터가
                                                    영구적으로 삭제됩니다
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
                                </div>
                            </>
                        )}
                    </section>
                </div>
            </main>

            <Footer />
        </>
    );
}
