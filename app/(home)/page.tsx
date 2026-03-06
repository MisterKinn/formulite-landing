"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import AOS from "aos";
import { useRouter, useSearchParams } from "next/navigation";
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

        const registrationParams = new URLSearchParams({
            amount: String(pendingPayment.amount),
            orderName: pendingPayment.orderName,
        });
        if (pendingPayment.billingCycle) {
            registrationParams.set("billingCycle", pendingPayment.billingCycle);
        }
        window.location.href = `/card-registration?${registrationParams.toString()}`;
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
