"use client";

import { useState, useEffect, useRef } from "react";

export default function BillingMonitorPage() {
    const [logs, setLogs] = useState<string[]>([]);
    const [running, setRunning] = useState(false);
    const [lastResult, setLastResult] = useState<any>(null);
    const [subscriptions, setSubscriptions] = useState<any[]>([]);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    const addLog = (msg: string) => {
        const time = new Date().toLocaleTimeString("ko-KR");
        setLogs((prev) => [`[${time}] ${msg}`, ...prev.slice(0, 99)]);
    };

    const fetchSubscriptions = async () => {
        try {
            const res = await fetch("/api/debug/all-subscriptions");
            const data = await res.json();
            if (data.subscriptions) {
                setSubscriptions(data.subscriptions);
            }
        } catch (e) {
            console.error("Failed to fetch subscriptions:", e);
        }
    };

    const triggerBilling = async () => {
        addLog("⏰ Triggering scheduled billing...");
        try {
            const res = await fetch("/api/billing/scheduled", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
            });
            const data = await res.json();
            setLastResult(data);

            if (data.success) {
                const { summary } = data;
                addLog(
                    `✅ Processed: ${summary.totalProcessed}, Success: ${summary.successful}, Failed: ${summary.failed}, Amount: ${summary.totalAmount}원`,
                );
                if (summary.failed > 0) {
                    data.results
                        ?.filter((r: any) => !r.success)
                        .forEach((r: any) => {
                            addLog(`   ❌ ${r.userId}: ${r.error}`);
                        });
                }
                if (summary.successful > 0) {
                    data.results
                        ?.filter((r: any) => r.success)
                        .forEach((r: any) => {
                            addLog(`   💰 ${r.userId}: Charged successfully`);
                        });
                }
            } else {
                addLog(`❌ Error: ${data.error || data.message}`);
            }
            fetchSubscriptions();
        } catch (error) {
            addLog(`❌ Request failed: ${error}`);
        }
    };

    const startAutoRun = () => {
        if (intervalRef.current) return;
        setRunning(true);
        addLog("🚀 Auto-billing started (every 10 seconds for test plans)");
        triggerBilling(); // Run immediately
        intervalRef.current = setInterval(triggerBilling, 10000); // Every 10 sec for faster testing
    };

    const stopAutoRun = () => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
        setRunning(false);
        addLog("🛑 Auto-billing stopped");
    };

    useEffect(() => {
        fetchSubscriptions();
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, []);

    return (
        <div
            style={{
                padding: 32,
                background: "#0a0a0a",
                minHeight: "100vh",
                color: "#fff",
                fontFamily: "system-ui",
            }}
        >
            <h1 style={{ fontSize: 28, marginBottom: 8 }}>
                💳 Billing Monitor
            </h1>
            <p style={{ color: "#888", marginBottom: 24 }}>
                Automatically triggers billing every 10 seconds for test
                subscriptions (test plan charges every 1 minute)
            </p>

            <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
                {!running ? (
                    <button
                        onClick={startAutoRun}
                        style={{
                            padding: "12px 24px",
                            background: "#22c55e",
                            border: "none",
                            borderRadius: 8,
                            color: "#fff",
                            fontWeight: 600,
                            cursor: "pointer",
                        }}
                    >
                        🚀 Start Auto-Billing
                    </button>
                ) : (
                    <button
                        onClick={stopAutoRun}
                        style={{
                            padding: "12px 24px",
                            background: "#ef4444",
                            border: "none",
                            borderRadius: 8,
                            color: "#fff",
                            fontWeight: 600,
                            cursor: "pointer",
                        }}
                    >
                        🛑 Stop
                    </button>
                )}
                <button
                    onClick={triggerBilling}
                    style={{
                        padding: "12px 24px",
                        background: "#3b82f6",
                        border: "none",
                        borderRadius: 8,
                        color: "#fff",
                        fontWeight: 600,
                        cursor: "pointer",
                    }}
                >
                    ⚡ Run Once
                </button>
            </div>

            {running && (
                <div
                    style={{
                        padding: 12,
                        background: "#166534",
                        borderRadius: 8,
                        marginBottom: 24,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                    }}
                >
                    <span style={{ animation: "pulse 1s infinite" }}>🟢</span>
                    Auto-billing is running...
                </div>
            )}

            {/* Active Subscriptions */}
            {subscriptions.length > 0 && (
                <div
                    style={{
                        background: "#1a1a1a",
                        padding: 16,
                        borderRadius: 8,
                        marginBottom: 24,
                    }}
                >
                    <h3 style={{ marginBottom: 12 }}>
                        Active Subscriptions ({subscriptions.length})
                    </h3>
                    <div style={{ overflowX: "auto" }}>
                        <table
                            style={{
                                width: "100%",
                                fontSize: 13,
                                borderCollapse: "collapse",
                            }}
                        >
                            <thead>
                                <tr
                                    style={{
                                        borderBottom: "1px solid #333",
                                        textAlign: "left",
                                    }}
                                >
                                    <th style={{ padding: 8 }}>User</th>
                                    <th style={{ padding: 8 }}>Plan</th>
                                    <th style={{ padding: 8 }}>Amount</th>
                                    <th style={{ padding: 8 }}>Cycle</th>
                                    <th style={{ padding: 8 }}>Next Billing</th>
                                    <th style={{ padding: 8 }}>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {subscriptions.map((sub) => (
                                    <tr
                                        key={sub.userId}
                                        style={{
                                            borderBottom: "1px solid #222",
                                        }}
                                    >
                                        <td
                                            style={{
                                                padding: 8,
                                                fontFamily: "monospace",
                                                fontSize: 11,
                                            }}
                                        >
                                            {sub.email ||
                                                sub.userId.slice(0, 12) + "..."}
                                        </td>
                                        <td style={{ padding: 8 }}>
                                            {sub.plan}
                                        </td>
                                        <td style={{ padding: 8 }}>
                                            {sub.amount}원
                                        </td>
                                        <td style={{ padding: 8 }}>
                                            {sub.billingCycle}
                                        </td>
                                        <td
                                            style={{ padding: 8, fontSize: 11 }}
                                        >
                                            {sub.nextBillingDate
                                                ? new Date(
                                                      sub.nextBillingDate,
                                                  ).toLocaleString("ko-KR")
                                                : "-"}
                                        </td>
                                        <td style={{ padding: 8 }}>
                                            {sub.isDue ? (
                                                <span
                                                    style={{ color: "#22c55e" }}
                                                >
                                                    ✅ Due
                                                </span>
                                            ) : (
                                                <span style={{ color: "#888" }}>
                                                    ⏳ {sub.timeUntilDue}s
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {lastResult && (
                <div
                    style={{
                        background: "#1a1a1a",
                        padding: 16,
                        borderRadius: 8,
                        marginBottom: 24,
                    }}
                >
                    <h3 style={{ marginBottom: 8 }}>Last Result</h3>
                    <pre
                        style={{
                            fontSize: 12,
                            color: "#aaa",
                            overflow: "auto",
                            maxHeight: 200,
                        }}
                    >
                        {JSON.stringify(lastResult, null, 2)}
                    </pre>
                </div>
            )}

            <div
                style={{
                    background: "#111",
                    padding: 16,
                    borderRadius: 8,
                    height: 400,
                    overflow: "auto",
                }}
            >
                <h3 style={{ marginBottom: 12 }}>Logs</h3>
                {logs.length === 0 ? (
                    <p style={{ color: "#666" }}>
                        No logs yet. Start auto-billing or run once.
                    </p>
                ) : (
                    logs.map((log, i) => (
                        <div
                            key={i}
                            style={{
                                fontSize: 13,
                                color: "#ccc",
                                marginBottom: 4,
                                fontFamily: "monospace",
                            }}
                        >
                            {log}
                        </div>
                    ))
                )}
            </div>

            <style jsx>{`
                @keyframes pulse {
                    0%,
                    100% {
                        opacity: 1;
                    }
                    50% {
                        opacity: 0.5;
                    }
                }
            `}</style>
        </div>
    );
}
