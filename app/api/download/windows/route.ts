const WINDOWS_DOWNLOAD_URL =
    "https://storage.googleapis.com/physics2/NovaAI_Setup_2.1.1.exe";

export async function GET() {
    try {
        const upstreamResponse = await fetch(WINDOWS_DOWNLOAD_URL, {
            cache: "no-store",
        });

        if (!upstreamResponse.ok || !upstreamResponse.body) {
            return Response.json(
                { message: "설치 파일을 불러오지 못했습니다." },
                { status: 502 },
            );
        }

        return new Response(upstreamResponse.body, {
            headers: {
                "Content-Type":
                    upstreamResponse.headers.get("content-type") ??
                    "application/octet-stream",
                "Content-Disposition":
                    'attachment; filename="NovaAI_Setup_2.1.1.exe"',
                "Cache-Control": "no-store",
            },
        });
    } catch {
        return Response.json(
            { message: "설치 파일 다운로드 중 오류가 발생했습니다." },
            { status: 500 },
        );
    }
}
