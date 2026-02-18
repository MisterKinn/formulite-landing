"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import AOS from "aos";
import { useRouter, useSearchParams } from "next/navigation";
import { loadTossPayments } from "@tosspayments/tosspayments-sdk";
import "aos/dist/aos.css";
import "../style.css";
import "../mobile.css";
import { useAuth } from "@/context/AuthContext";

import Home from "../../components/Home";
import ExamTyping from "../../components/ExamTyping";
import GeminiAI from "../../components/GeminiAI";
import CostComparison from "../../components/CostComparison";
import Pricing from "../../components/Pricing";
import FAQ from "../../components/FAQ";
import CTA from "../../components/CTA";
import { Navbar } from "../../components/Navbar";
import Footer from "../../components/Footer";

function FormuLiteContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { isAuthenticated, loading, user } = useAuth();
    const paymentStartedRef = useRef(false);

    const pendingPayment = useMemo(() => {
        if (searchParams.get("openPayment") !== "true") return null;
        const amountRaw = searchParams.get("amount");
        const orderNameRaw = searchParams.get("orderName");
        const billingCycleRaw = searchParams.get("billingCycle");
        if (!amountRaw || !orderNameRaw) return null;
        const amount = Number(amountRaw);
        if (Number.isNaN(amount) || amount <= 0) return null;
        return {
            amount,
            orderName: orderNameRaw,
            billingCycle: billingCycleRaw ?? undefined,
        };
    }, [searchParams]);

    useEffect(() => {
        AOS.init({
            duration: 800,
            easing: "ease-out-cubic",
            offset: 60,
            once: false,
        });
    }, []);

    useEffect(() => {
        void fetch("/api/analytics/visit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ page: "/" }),
        }).catch(() => {
            // Non-blocking analytics call
        });
    }, []);

    useEffect(() => {
        paymentStartedRef.current = false;
    }, [pendingPayment?.amount, pendingPayment?.orderName, pendingPayment?.billingCycle]);

    useEffect(() => {
        if (!pendingPayment) return;
        if (loading) return;

        if (!isAuthenticated) {
            const loginParams = new URLSearchParams({
                postLoginAction: "payment",
                amount: String(pendingPayment.amount),
                orderName: pendingPayment.orderName,
            });
            if (pendingPayment.billingCycle) {
                loginParams.set("billingCycle", pendingPayment.billingCycle);
            }
            router.replace(`/login?${loginParams.toString()}`);
            return;
        }

        if (!user?.uid || paymentStartedRef.current) return;
        paymentStartedRef.current = true;

        const startPayment = async () => {
            try {
                const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY?.trim() || "";

                if (
                    !clientKey.startsWith("test_ck_") &&
                    !clientKey.startsWith("live_ck_")
                ) {
                    window.alert(
                        "토스 결제 클라이언트 키 형식이 올바르지 않습니다. NEXT_PUBLIC_TOSS_CLIENT_KEY를 확인해주세요.",
                    );
                    router.replace("/");
                    return;
                }

                const tossPayments = await loadTossPayments(clientKey);
                const payment = tossPayments.payment({
                    customerKey: `user_${user.uid
                        .replace(/[^a-zA-Z0-9\-_=.@]/g, "")
                        .substring(0, 40)}`,
                });

                await payment.requestPayment({
                    method: "CARD",
                    amount: {
                        value: pendingPayment.amount,
                        currency: "KRW",
                    },
                    orderId: `order_${Date.now()}`,
                    orderName: pendingPayment.orderName,
                    successUrl: `${window.location.origin}/payment/success?uid=${encodeURIComponent(user.uid)}`,
                    failUrl: `${window.location.origin}/payment/fail`,
                    customerEmail: user.email || "test@example.com",
                    customerName: user.displayName || "고객",
                });
            } catch (error: any) {
                window.alert(error?.message || "결제 요청 중 오류가 발생했습니다.");
                router.replace("/");
            }
        };

        void startPayment();
    }, [isAuthenticated, loading, pendingPayment, router, user]);

    return (
        <div>
            <Navbar />

            <Home />
            <ExamTyping />
            <GeminiAI />
            <CostComparison />
            <Pricing />
            <FAQ />
            <CTA />
            <Footer />
        </div>
    );
}

export default function FormuLite() {
    return (
        <Suspense fallback={null}>
            <FormuLiteContent />
        </Suspense>
    );
}
