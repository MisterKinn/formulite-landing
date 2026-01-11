import React from "react";
import dynamic from "next/dynamic";
import { Navbar } from "../../components/Navbar";
import Sidebar from "../../components/Sidebar";
import PaymentClient from "./PaymentClient";
import "../style.css";
import "../mobile.css";

declare global {
    interface Window {
        PaymentWidge능t: any;
    }
}

export default function PaymentPage() {
    return (
        <>
            <Navbar />
            <Sidebar />

            <React.Suspense fallback={<div style={{ minHeight: 420 }} />}>
                <PaymentClient />
            </React.Suspense>
        </>
    );
}

/* styles */
const container: React.CSSProperties = {
    minHeight: "100vh",
    background: "#050506",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    color: "#fff",
};

const card: React.CSSProperties = {
    width: 520,
    background: "#ffffff",
    color: "#0b1220",
    borderRadius: 16,
    padding: 20,
    boxShadow: "0 12px 40px rgba(2,6,23,0.08)",
};

const center: React.CSSProperties = {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
};
