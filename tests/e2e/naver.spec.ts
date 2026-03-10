import { test, expect } from "@playwright/test";
import getFirebaseAdmin from "../../lib/firebaseAdmin";

// Test assumes dev server is running on localhost:3000 and that DEV_AUTH_BYPASS is enabled
// It uses the dev simulate endpoint to post an oauth-dev message and then asserts
// the profile is displayed and the Firestore users doc exists.

test.describe("Naver OAuth (dev simulate) E2E", () => {
    test("should sign in via simulate-naver and persist profile", async ({
        page,
    }) => {
        const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        await page.goto(`${base}/login`);

        // Click the Naver button and try to get the popup
        let popup: any = null;
        try {
            const popupPromise = page.waitForEvent("popup", { timeout: 2000 });
            await page.click("button.naver-btn");
            popup = await popupPromise.catch(() => null);
        } catch (err) {
            // ignore
        }

        const profileObj = {
            id: "e2e-id",
            email: "e2e@example.com",
            name: "E2E Test",
            profile_image: null,
        };
        const simulateUrl = `${base}/api/debug/simulate-naver?admin_secret=$ADMIN_SECRET&id=${encodeURIComponent(
            profileObj.id
        )}&email=${encodeURIComponent(
            profileObj.email
        )}&name=${encodeURIComponent(profileObj.name)}`;

        // Wait for client to set up local state (loginWithNaver stores a state in localStorage) so message handler is installed
        try {
            await page.waitForFunction(
                () => !!localStorage.getItem("naver_oauth_state"),
                { timeout: 3000 }
            );
        } catch (err) {
            // not fatal — continue to post message, but handler may miss early messages if not installed
        }

        if (popup && !popup.isClosed?.()) {
            // try to navigate popup to the simulate endpoint
            try {
                await popup.goto(simulateUrl, { waitUntil: "load" });
                try {
                    await popup.waitForEvent("close", { timeout: 5000 });
                } catch (e) {
                    /* ignore */
                }
            } catch (err) {
                // popup may have been redirected/closed by the provider; fall back to posting message directly
                await page.evaluate((profile) => {
                    try {
                        window.postMessage(
                            { type: "oauth-dev", provider: "naver", profile },
                            window.location.origin
                        );
                    } catch (e) {}
                }, profileObj);
            }
        } else {
            // No popup available — simulate posting the oauth-dev message directly to the app window
            await page.evaluate((profile) => {
                try {
                    window.postMessage(
                        { type: "oauth-dev", provider: "naver", profile },
                        window.location.origin
                    );
                } catch (e) {}
            }, profileObj);
        }

        // Wait for the app to settle and navigate to profile page
        await page.waitForTimeout(1000);
        // Wait for Firestore doc to be created (poll for up to 10s)
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
        const docRef = db.collection("users").doc("naver:e2e-id");

        let snap = await docRef.get();
        const start = Date.now();
        while (!snap.exists && Date.now() - start < 10000) {
            await new Promise((r) => setTimeout(r, 500));
            snap = await docRef.get();
        }
        expect(snap.exists).toBeTruthy();
        const data = snap.data() || {};
        expect(data.email).toBe("e2e@example.com");
        expect(data.displayName).toBe("E2E Test");

        // Now open profile and assert fields populate
        await page.goto(`${base}/profile`);
        const nameInput = page.locator(
            'input.profile-input[placeholder="이름을 입력하세요"]'
        );
        const emailInput = page.locator(
            "input.profile-input.profile-input-disabled"
        );

        await expect(nameInput).toHaveValue("E2E Test", { timeout: 10000 });
        await expect(emailInput).toHaveValue("e2e@example.com", {
            timeout: 10000,
        });
    });
});
