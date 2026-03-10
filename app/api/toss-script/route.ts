import { NextResponse } from "next/server";

export async function GET() {
    const url = "https://js.tosspayments.com/v2/payment-widget";
    try {
        const res = await fetch(url, { method: "HEAD" });
        const headers: Record<string, string> = {};
        res.headers.forEach((v, k) => {
            headers[k] = v;
        });
        return NextResponse.json({ ok: res.ok, status: res.status, headers });
    } catch (err) {
        return NextResponse.json(
            { ok: false, error: String(err) },
            { status: 500 }
        );
    }
}
