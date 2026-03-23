import fs from "node:fs";
import type { ReadStream } from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_FILES = new Set([
    "book_test.mp4",
    "eng_test.mp4",
    "kor_test.mp4",
    "math_test.mp4",
    "science_test.mp4",
]);

function createVideoStreamResponseBody(stream: ReadStream): ReadableStream<Uint8Array> {
    const iterator = stream[Symbol.asyncIterator]();
    let closed = false;

    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            if (closed) return;

            try {
                const { value, done } = await iterator.next();

                if (done) {
                    closed = true;
                    controller.close();
                    return;
                }

                controller.enqueue(
                    value instanceof Uint8Array ? value : new Uint8Array(value),
                );
            } catch (error) {
                closed = true;
                controller.error(error);
            }
        },
        cancel() {
            if (closed) return;
            closed = true;
            stream.destroy();
        },
    });
}

async function buildVideoResponse(
    request: NextRequest,
    context: { params: Promise<{ name: string }> },
    method: "GET" | "HEAD",
) {
    const { name } = await context.params;

    if (!ALLOWED_FILES.has(name)) {
        return NextResponse.json(
            { error: "지원하지 않는 영상 파일입니다." },
            { status: 404 },
        );
    }

    const filePath = path.join(process.cwd(), "nova-ai", "test_movie", name);

    try {
        const stat = await fsPromises.stat(filePath);
        const fileSize = stat.size;
        const rangeHeader = request.headers.get("range");

        if (rangeHeader) {
            const matches = /bytes=(\d*)-(\d*)/.exec(rangeHeader);

            if (!matches) {
                return new NextResponse(null, {
                    status: 416,
                    headers: {
                        "Content-Range": `bytes */${fileSize}`,
                    },
                });
            }

            const start = matches[1] ? Number.parseInt(matches[1], 10) : 0;
            const end = matches[2] ? Number.parseInt(matches[2], 10) : fileSize - 1;

            if (
                Number.isNaN(start) ||
                Number.isNaN(end) ||
                start < 0 ||
                end >= fileSize ||
                start > end
            ) {
                return new NextResponse(null, {
                    status: 416,
                    headers: {
                        "Content-Range": `bytes */${fileSize}`,
                    },
                });
            }

            const chunkSize = end - start + 1;

            if (method === "HEAD") {
                return new NextResponse(null, {
                    status: 206,
                    headers: {
                        "Accept-Ranges": "bytes",
                        "Cache-Control": "public, max-age=3600",
                        "Content-Length": String(chunkSize),
                        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
                        "Content-Type": "video/mp4",
                    },
                });
            }

            const stream = fs.createReadStream(filePath, { start, end });

            return new NextResponse(createVideoStreamResponseBody(stream), {
                status: 206,
                headers: {
                    "Accept-Ranges": "bytes",
                    "Cache-Control": "public, max-age=3600",
                    "Content-Length": String(chunkSize),
                    "Content-Range": `bytes ${start}-${end}/${fileSize}`,
                    "Content-Type": "video/mp4",
                },
            });
        }

        if (method === "HEAD") {
            return new NextResponse(null, {
                status: 200,
                headers: {
                    "Accept-Ranges": "bytes",
                    "Cache-Control": "public, max-age=3600",
                    "Content-Length": String(fileSize),
                    "Content-Type": "video/mp4",
                },
            });
        }

        const stream = fs.createReadStream(filePath);

        return new NextResponse(createVideoStreamResponseBody(stream), {
            status: 200,
            headers: {
                "Accept-Ranges": "bytes",
                "Content-Length": String(fileSize),
                "Content-Type": "video/mp4",
                "Cache-Control": "public, max-age=3600",
            },
        });
    } catch {
        return NextResponse.json(
            { error: "영상 파일을 찾을 수 없습니다." },
            { status: 404 },
        );
    }
}

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ name: string }> },
) {
    return buildVideoResponse(request, context, "GET");
}

export async function HEAD(
    request: NextRequest,
    context: { params: Promise<{ name: string }> },
) {
    return buildVideoResponse(request, context, "HEAD");
}
