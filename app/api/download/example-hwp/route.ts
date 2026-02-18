import { promises as fs } from "fs";
import path from "path";

export async function GET() {
    try {
        const filePath = path.join(process.cwd(), "2611고3수학.hwp");
        const fileBuffer = await fs.readFile(filePath);

        return new Response(fileBuffer, {
            headers: {
                "Content-Type": "application/octet-stream",
                "Content-Disposition": 'attachment; filename="2611-go3-math.hwp"',
                "Cache-Control": "no-store",
            },
        });
    } catch {
        return Response.json(
            { message: "예시 파일을 찾을 수 없습니다." },
            { status: 404 }
        );
    }
}
