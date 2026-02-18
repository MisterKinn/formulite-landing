import { test, expect } from "@playwright/test";
import getFirebaseAdmin from "../../lib/firebaseAdmin";

// Test assumes dev server is running on localhost:3000 and that DEV_AUTH_BYPASS is enabled
// It uses the dev simulate endpoint to post an oauth-dev message and then asserts
// the profile is displayed and the Firestore users doc exists.

test.describe("Kakao OAuth (dev simulate) E2E", () => {
    test("should sign in via simulate-kakao and persist profile", async ({
        page,
    }) => {
        const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        await page.goto(`${base}/login`);

        // Click the Kakao button and try to catch popup
        let popup: any = null;
        try {
            const popupPromise = page.waitForEvent("popup", { timeout: 2000 });
            await page.click("button.kakao-btn");
            popup = await popupPromise.catch(() => null);
        } catch (err) {
            // ignore
        }

        const profileObj = {
            id: "e2e-kakao-id",
            email: "e2e-kakao@example.com",
            name: "E2E Kakao",
            profile_image: null,
        };

        // Wait for client state (loginWithKakao stores a state in localStorage)
        try {
            await page.waitForFunction(
                () => !!localStorage.getItem("kakao_oauth_state"),
                { timeout: 3000 }
            );
        } catch (err) {
            // continue
        }

        // Navigate the popup to the simulate-kakao endpoint so it posts the oauth message
        const simulateUrl = `${base}/api/debug/simulate-kakao?admin_secret=$ADMIN_SECRET&id=${encodeURIComponent(
            profileObj.id
        )}&email=${encodeURIComponent(
            profileObj.email
        )}&name=${encodeURIComponent(profileObj.name)}`;
        if (popup) {
            try {
                await popup.goto(simulateUrl, {
                    waitUntil: "load",
                    timeout: 5000,
                });
            } catch (e) {
                // ignore navigation errors
            }
        } else {
            // If popup wasn't captured, open simulate URL directly which will post message to the opener
            await page.goto(simulateUrl);
        }

        // Verify Firestore doc exists and contains the profile
        let admin: any;
        try {
            admin = getFirebaseAdmin();
        } catch (err: any) {
            test.fail(
                true,
                "Firebase Admin is not configured for tests: " +
                    String(err?.message || err)
            );
            return;
        }

        const db = admin.firestore();
        const docRef = db.collection("users").doc("kakao:e2e-kakao-id");

        let snap = await docRef.get();
        const start = Date.now();
        while (!snap.exists && Date.now() - start < 10000) {
            await new Promise((r) => setTimeout(r, 500));
            snap = await docRef.get();
        }
        expect(snap.exists).toBeTruthy();
        const data = snap.data() || {};
        expect(data.email).toBe("e2e-kakao@example.com");
        expect(data.displayName).toBe("E2E Kakao");

        // Now open profile and assert fields populate
        await page.goto(`${base}/profile`);
        const nameInput = page.locator(
            'input.profile-input[placeholder="이름을 입력하세요"]'
        );
        const emailInput = page.locator(
            "input.profile-input.profile-input-disabled"
        );

        await expect(nameInput).toHaveValue("E2E Kakao", { timeout: 10000 });
        await expect(emailInput).toHaveValue("e2e-kakao@example.com", {
            timeout: 10000,
        });
    });
});
