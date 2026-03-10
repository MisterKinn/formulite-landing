import { NextResponse } from "next/server";

export async function GET() {
    return NextResponse.json(
        { error: "kakao_login_disabled", message: "카카오 로그인은 비활성화되었습니다." },
        { status: 410 },
    );
}
