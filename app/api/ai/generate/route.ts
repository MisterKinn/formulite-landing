import { NextRequest, NextResponse } from "next/server";

/**
 * Example API endpoint that uses AI call limits
 * POST /api/ai/generate
 * Body: { userId: string, prompt: string }
 *
 * This demonstrates how to:
 * 1. Check if user can make an AI call
 * 2. Perform the AI operation
 * 3. Increment the usage counter
 */
export async function POST(request: NextRequest) {
    try {
        const { userId, prompt } = await request.json();

        if (!userId || !prompt) {
            return NextResponse.json(
                { error: "userId and prompt are required" },
                { status: 400 }
            );
        }

        // Step 1: Check if user can make an AI call
        const checkResponse = await fetch(
            `${
                process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
            }/api/ai/check-limit?userId=${userId}`,
            { method: "GET" }
        );

        if (!checkResponse.ok) {
            return NextResponse.json(
                { error: "Failed to check usage limit" },
                { status: 500 }
            );
        }

        const limitCheck = await checkResponse.json();

        if (!limitCheck.canUse) {
            return NextResponse.json(
                {
                    error: "Usage limit exceeded",
                    currentUsage: limitCheck.currentUsage,
                    limit: limitCheck.limit,
                    plan: limitCheck.plan,
                },
                { status: 429 }
            );
        }

        // Step 2: Perform your AI operation here
        // Example: Call OpenAI, Anthropic, or your AI service
        const aiResult = await simulateAIGeneration(prompt);

        // Step 3: Increment usage counter after successful AI call
        const incrementResponse = await fetch(
            `${
                process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
            }/api/ai/increment-usage`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId }),
            }
        );

        if (!incrementResponse.ok) {
            console.error("Failed to increment usage counter");
            // Continue anyway since the AI call succeeded
        }

        const usageData = await incrementResponse.json();

        return NextResponse.json({
            success: true,
            result: aiResult,
            usage: {
                currentUsage: usageData.currentUsage,
                limit: usageData.limit,
                remaining: usageData.remaining,
            },
        });
    } catch (error) {
        console.error("Error in AI generation:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}

// Simulate AI generation (replace with actual AI service call)
async function simulateAIGeneration(prompt: string): Promise<string> {
    // In production, replace this with your actual AI service:
    // const response = await openai.chat.completions.create({ ... });
    // return response.choices[0].message.content;

    await new Promise((resolve) => setTimeout(resolve, 100));
    return `Generated response for: ${prompt}`;
}
