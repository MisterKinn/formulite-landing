import { NextResponse } from "next/server";

export async function GET() {
    return NextResponse.json(
        { error: "naver_login_disabled", message: "네이버 로그인은 비활성화되었습니다." },
        { status: 410 },
    );
}
