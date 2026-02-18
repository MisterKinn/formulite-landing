"use client";
import React, {
    createContext,
    useContext,
    useEffect,
    useState,
    useRef,
} from "react";
import {
    getAuth,
    onAuthStateChanged,
    User,
    updateProfile,
    updateEmail,
    signOut,
} from "firebase/auth";
import { getFirebaseAppOrNull } from "../firebaseConfig";
import {
    getFirestore,
    doc,
    getDoc,
    setDoc,
    enableNetwork,
} from "firebase/firestore";
import { nowIsoString } from "@/lib/userData";

import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    GoogleAuthProvider,
    signInWithPopup,
    sendPasswordResetEmail,
} from "firebase/auth";

interface AuthContextType {
    user: User | null;
    loading: boolean;
    avatar: string | null;
    loginWithEmail: (email: string, password: string) => Promise<User>;
    signupWithEmail: (
        email: string,
        password: string,
        displayName?: string,
    ) => Promise<User>;
    loginWithGoogle: () => Promise<User>;
    loginWithNaver: () => Promise<User>;
    loginWithKakao: () => Promise<User>;
    requestPasswordReset: (email: string) => Promise<void>;
    updateAvatar: (dataUrl: string | null) => Promise<void>;
    updateSubscription: (
        data: import("@/lib/subscription").SubscriptionData,
    ) => Promise<void>;
    logout: () => Promise<void>;
    isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
    avatar: null,
    loginWithEmail: async () => {
        throw new Error("Not implemented");
    },
    signupWithEmail: async () => {
        throw new Error("Not implemented");
    },
    loginWithGoogle: async () => {
        throw new Error("Not implemented");
    },
    loginWithNaver: async () => {
        throw new Error("Not implemented");
    },
    loginWithKakao: async () => {
        throw new Error("Not implemented");
    },
    requestPasswordReset: async () => {
        throw new Error("Not implemented");
    },
    updateAvatar: async () => {
        throw new Error("Not implemented");
    },
    updateSubscription: async () => {
        throw new Error("Not implemented");
    },
    logout: async () => {
        throw new Error("Not implemented");
    },
    isAuthenticated: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [avatar, setAvatar] = useState<string | null>(null);
    const initialAuthCheckedRef = useRef(false);
    const prevUserRef = useRef<User | null>(null);

    useEffect(() => {
        const firebaseApp = getFirebaseAppOrNull();
        if (!firebaseApp) {
            // Firebase isn't configured (no NEXT_PUBLIC_FIREBASE_*). Keep app usable.
            setUser(null);
            setAvatar(null);
            setLoading(false);
            return;
        }

        const auth = getAuth(firebaseApp);

        const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
            setUser(firebaseUser);
            setLoading(false);

            // If this is not the initial auth check, and we just transitioned
            // from unauthenticated -> authenticated, redirect to the main page.
            try {
                if (!initialAuthCheckedRef.current) {
                    initialAuthCheckedRef.current = true;
                } else {
                    if (firebaseUser && !prevUserRef.current) {
                        try {
                            const isOnLoginPage =
                                window.location.pathname === "/login";
                            // Let the login page handle post-login redirects.
                            if (!isOnLoginPage) {
                                window.location.href = "/";
                            }
                        } catch (e) {
                            /* ignore navigation errors */
                        }
                    }
                }
            } catch (e) {
                /* noop */
            }

            prevUserRef.current = firebaseUser;

            // load avatar from Firestore when user signs in; also ensure basic profile fields are present
            (async () => {
                if (!firebaseUser) {
                    setAvatar(null);
                    return;
                }

                try {
                    const db = getFirestore(firebaseApp);
                    const docRef = doc(db, "users", firebaseUser.uid);

                    const avatarFromAuth =
                        (firebaseUser.photoURL as string) || null;
                    const displayNameFromAuth =
                        firebaseUser.displayName || null;
                    const emailFromAuth = firebaseUser.email || null;

                    // Try to read the user doc, with a short retry loop to account for eventual consistency
                    // when the server has just written the profile during the OAuth callback.
                    let snap = await getDoc(docRef);
                    const maxAttempts = 6;
                    let attempt = 0;
                    while (
                        attempt < maxAttempts &&
                        (!snap.exists() ||
                            (!snap.data()?.avatar &&
                                !snap.data()?.displayName &&
                                !snap.data()?.email))
                    ) {
                        // If a doc exists and has some fields, accept it
                        if (
                            snap.exists() &&
                            (snap.data()?.avatar ||
                                snap.data()?.displayName ||
                                snap.data()?.email)
                        )
                            break;
                        // wait and retry
                        await new Promise((r) => setTimeout(r, 250));
                        snap = await getDoc(docRef);
                        attempt++;
                    }

                    if (!snap.exists()) {
                        // create initial doc from Auth profile when missing
                        await setDoc(
                            docRef,
                            {
                                avatar: avatarFromAuth,
                                displayName: displayNameFromAuth,
                                email: emailFromAuth,
                                plan: "free",
                                aiCallUsage: 0,
                                createdAt: nowIsoString(),
                                updatedAt: nowIsoString(),
                            },
                            { merge: true },
                        );
                        setAvatar(avatarFromAuth);
                        return;
                    }

                    const data = snap.data() as any;

                    // If Firestore doc is missing key profile fields, merge values from Auth
                    const updates: any = {};
                    if (!data?.displayName && displayNameFromAuth)
                        updates.displayName = displayNameFromAuth;
                    if (!data?.email && emailFromAuth)
                        updates.email = emailFromAuth;
                    if (!data?.avatar && avatarFromAuth)
                        updates.avatar = avatarFromAuth;
                    if (!data?.plan) updates.plan = "free";
                    if (data?.aiCallUsage === undefined)
                        updates.aiCallUsage = 0;
                    if (Object.keys(updates).length > 0) {
                        updates.updatedAt = nowIsoString();
                        await setDoc(docRef, updates, { merge: true });
                    }

                    // Prefer Firestore avatar when present, otherwise fall back to Auth avatar
                    setAvatar(data?.avatar ?? avatarFromAuth);
                } catch (err) {
                    // If anything goes wrong, do not clobber a previously-set avatar (best-effort).
                    console.warn(
                        "[AuthContext] Failed to load or init user doc (non-fatal)",
                        err,
                    );
                }
            })();
        });
        return () => unsubscribe();
    }, []);

    // Auto-billing check for test subscriptions (runs every 15 seconds)
    // This ensures test plans (100원/1분) are charged automatically
    useEffect(() => {
        if (!user) return;

        let intervalId: NodeJS.Timeout | null = null;

        const checkAndProcessBilling = async () => {
            try {
                // First check if this user has a test subscription
                const firebaseApp = getFirebaseAppOrNull();
                if (!firebaseApp) return;
                const db = getFirestore(firebaseApp);
                const userDoc = await getDoc(doc(db, "users", user.uid));

                if (!userDoc.exists()) return;

                const subscription = userDoc.data()?.subscription;

                // Only trigger billing for test subscriptions that are due
                if (
                    subscription?.billingCycle === "test" &&
                    subscription?.status === "active" &&
                    subscription?.isRecurring &&
                    subscription?.nextBillingDate
                ) {
                    const nextBilling = new Date(subscription.nextBillingDate);
                    const now = new Date();

                    if (nextBilling <= now) {
                        console.log(
                            "🔄 [AutoBilling] Test subscription due, triggering billing...",
                        );

                        // Trigger the scheduled billing endpoint
                        const res = await fetch("/api/billing/scheduled", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                        });

                        const data = await res.json();
                        if (data.success && data.summary?.successful > 0) {
                            console.log(
                                "✅ [AutoBilling] Payment processed successfully",
                            );
                        }
                    }
                }
            } catch (err) {
                // Silent fail - this is background billing check
                console.warn("[AutoBilling] Check failed:", err);
            }
        };

        // Run immediately and then every 15 seconds
        checkAndProcessBilling();
        intervalId = setInterval(checkAndProcessBilling, 15000);

        return () => {
            if (intervalId) clearInterval(intervalId);
        };
    }, [user]);

    // Auth methods
    const loginWithEmail = async (email: string, password: string) => {
        const firebaseApp = getFirebaseAppOrNull();
        if (!firebaseApp) throw new Error("firebase_not_configured");
        const auth = getAuth(firebaseApp);
        try {
            const cred = await signInWithEmailAndPassword(
                auth,
                email,
                password,
            );
            setUser(cred.user);

            // Ensure Firestore user doc has basic profile fields (displayName/email/avatar)
            try {
                const db = getFirestore(firebaseApp);
                const docRef = doc(db, "users", cred.user.uid);
                const snap = await getDoc(docRef);
                const avatarFromAuth = (cred.user.photoURL as string) || null;
                if (!snap.exists()) {
                    await setDoc(
                        docRef,
                        {
                            avatar: avatarFromAuth,
                            displayName: cred.user.displayName || null,
                            email: cred.user.email || null,
                            createdAt: nowIsoString(),
                            updatedAt: nowIsoString(),
                            plan: "free",
                            aiCallUsage: 0,
                        },
                        { merge: true },
                    );
                    setAvatar(avatarFromAuth);
                } else {
                    setAvatar((snap.data() as any).avatar ?? avatarFromAuth);
                }
            } catch (err) {
                console.warn(
                    "[AuthContext] Failed to ensure user doc after email login",
                    err,
                );
            }

            return cred.user;
        } catch (err: any) {
            // Log richer error information to help diagnose HTTP 400 responses
            try {
                console.error("[AuthContext] loginWithEmail error", {
                    message: err?.message,
                    code: err?.code,
                    customData: err?.customData,
                    stack: err?.stack,
                });
            } catch (logErr) {
                console.error(
                    "[AuthContext] loginWithEmail error (unable to serialize)",
                    err,
                );
            }
            throw err;
        }
        // load avatar after login (separate step)
        // Note: avatar loading is intentionally not part of the auth try/catch above
    };

    const signupWithEmail = async (
        email: string,
        password: string,
        displayName?: string,
    ) => {
        const firebaseApp = getFirebaseAppOrNull();
        if (!firebaseApp) throw new Error("firebase_not_configured");
        const auth = getAuth(firebaseApp);
        const cred = await createUserWithEmailAndPassword(
            auth,
            email,
            password,
        );
        if (displayName) {
            await updateProfile(cred.user, { displayName });
        }
        setUser(cred.user);
        // create initial Firestore user doc
        try {
            const db = getFirestore(firebaseApp);
            const docRef = doc(db, "users", cred.user.uid);
            await setDoc(
                docRef,
                {
                    avatar: null,
                    displayName: displayName || cred.user.displayName || null,
                    email: cred.user.email || null,
                    createdAt: nowIsoString(),
                    updatedAt: nowIsoString(),
                    plan: "free",
                    aiCallUsage: 0,
                },
                { merge: true },
            );
            setAvatar(null);
        } catch (err) {
            // failed to create user doc
        }
        return cred.user;
    };

    // Helper to open a popup and wait for a postMessage containing { type: 'oauth', provider, customToken }
    const openPopupForProvider = (
        url: string,
        provider: string,
        timeout = 120000,
    ) =>
        new Promise<any>((resolve, reject) => {
            const w = window.open(
                url,
                `${provider}-auth`,
                "width=500,height=700",
            );
            if (!w) {
                reject(new Error("Popup blocked"));
                return;
            }

            const timer = setTimeout(() => {
                window.removeEventListener("message", handler);
                try {
                    if (w && typeof (w as any).close === "function")
                        (w as any).close();
                } catch (e) {}
                reject(new Error("Timeout waiting for authentication"));
            }, timeout);

            function handler(e: MessageEvent) {
                try {
                    // Accept messages from the same origin.
                    // In development, accept messages from the same hostname even if the port differs
                    if (e.origin !== window.location.origin) {
                        try {
                            const senderHost = new URL(e.origin).hostname;
                            const myHost = window.location.hostname;
                            if (
                                process.env.NODE_ENV === "production" ||
                                senderHost !== myHost
                            ) {
                                console.warn(
                                    "[AuthContext] Ignoring message from origin",
                                    e.origin,
                                );
                                return;
                            }
                            console.warn(
                                "[AuthContext] Accepting message from different origin (dev):",
                                e.origin,
                            );
                        } catch (err) {
                            console.warn(
                                "[AuthContext] Failed to parse message origin",
                                e.origin,
                                err,
                            );
                            return;
                        }
                    }

                    const data = e.data;
                    console.debug(
                        "[AuthContext] received oauth message",
                        e.origin,
                        data,
                    );

                    // Standard flow: { type: 'oauth', provider, customToken, profile? }
                    if (
                        data &&
                        data.type === "oauth" &&
                        data.provider === provider
                    ) {
                        clearTimeout(timer);
                        window.removeEventListener("message", handler);
                        try {
                            if (w && typeof (w as any).close === "function")
                                (w as any).close();
                        } catch (e) {}
                        if (data.customToken) {
                            // Return an object with token and optional profile so callers can use profile info
                            resolve({
                                customToken: String(data.customToken),
                                profile: data.profile || null,
                                returnTo: data.returnTo || null,
                            });
                            return;
                        }
                        reject(new Error("No custom token returned"));
                        return;
                    }

                    // Dev bypass flow (local only): { type: 'oauth-dev', provider, profile }
                    if (
                        process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "true" &&
                        data &&
                        data.type === "oauth-dev" &&
                        data.provider === provider
                    ) {
                        clearTimeout(timer);
                        window.removeEventListener("message", handler);
                        try {
                            if (w && typeof (w as any).close === "function")
                                (w as any).close();
                        } catch (e) {}
                        // Resolve with a special prefix so callers know it's a dev profile
                        resolve("DEV:" + JSON.stringify(data.profile));
                        return;
                    }

                    // Code exchange flow: { type: 'oauth-code', provider, code, state }
                    if (
                        data &&
                        data.type === "oauth-code" &&
                        data.provider === provider
                    ) {
                        clearTimeout(timer);
                        window.removeEventListener("message", handler);
                        try {
                            if (w && typeof (w as any).close === "function")
                                (w as any).close();
                        } catch (e) {}
                        // Resolve with JSON string containing code and state
                        resolve(
                            JSON.stringify({
                                code: data.code,
                                state: data.state,
                                returnTo: data.returnTo,
                            }),
                        );
                        return;
                    }

                    // otherwise ignore
                } catch (err) {
                    clearTimeout(timer);
                    window.removeEventListener("message", handler);
                    try {
                        if (w && typeof (w as any).close === "function")
                            (w as any).close();
                    } catch (e) {}
                    reject(err);
                }
            }

            window.addEventListener("message", handler);
        });

    const loginWithGoogle = async () => {
        const firebaseApp = getFirebaseAppOrNull();
        if (!firebaseApp) throw new Error("firebase_not_configured");
        const auth = getAuth(firebaseApp);
        const provider = new GoogleAuthProvider();

        // Try popup first; if the environment doesn't support popups (e.g. embedded webviews,
        // some browsers or third-party cookie restrictions), fall back to redirect.
        let cred: any = null;
        try {
            cred = await signInWithPopup(auth, provider);
            setUser(cred.user);
        } catch (err: any) {
            console.error("[AuthContext] signInWithPopup failed", err);
            const code = err?.code || "";

            // If popups are not supported in this environment, use redirect flow as a fallback.
            if (
                String(code).includes("operation-not-supported") ||
                String(code).includes("popup-blocked") ||
                String(code).includes("popup-closed-by-user") ||
                String(code).includes(
                    "auth/operation-not-supported-in-this-environment",
                )
            ) {
                try {
                    console.info(
                        "[AuthContext] Falling back to signInWithRedirect for Google sign-in",
                    );
                    // initiates redirect; app will reload and onAuthStateChanged will pick up the logged-in user
                    await import("firebase/auth").then(
                        ({ signInWithRedirect }) =>
                            signInWithRedirect(auth, provider),
                    );
                    // return a promise that never resolves here because redirect will navigate away
                    return new Promise(() => {});
                } catch (redirectErr) {
                    console.error(
                        "[AuthContext] signInWithRedirect failed",
                        redirectErr,
                    );
                    throw redirectErr;
                }
            }

            // Otherwise rethrow the original error for the UI to show a friendly message
            throw err;
        }

        // Update Firebase Auth profile (if provider provided displayName/photoURL)
        try {
            const displayName = cred.user.displayName || null;
            const photoURL = cred.user.photoURL || null;
            if (displayName || photoURL) {
                try {
                    await updateProfile(cred.user, {
                        displayName: displayName || undefined,
                        photoURL: photoURL || undefined,
                    });
                } catch (err) {
                    console.warn(
                        "[AuthContext] updateProfile failed (google)",
                        err,
                    );
                }
            }
            if (cred.user.email) {
                try {
                    await updateEmail(cred.user, cred.user.email);
                } catch (err) {
                    console.warn(
                        "[AuthContext] updateEmail failed (google)",
                        err,
                    );
                }
            }
            try {
                await (cred.user as any).reload?.();
            } catch (err) {
                console.warn("[AuthContext] user.reload failed (google)", err);
            }
        } catch (err) {
            console.warn(
                "[AuthContext] Failed to update auth profile after Google login",
                err,
            );
        }

        // load or create Firestore user doc for avatar and basic profile
        try {
            const db = getFirestore(firebaseApp);
            const docRef = doc(db, "users", cred.user.uid);
            const snap = await getDoc(docRef);
            if (!snap.exists()) {
                await setDoc(
                    docRef,
                    {
                        avatar: cred.user.photoURL || null,
                        displayName: cred.user.displayName || null,
                        email: cred.user.email || null,
                        createdAt: nowIsoString(),
                        updatedAt: nowIsoString(),
                        plan: "free",
                        aiCallUsage: 0,
                    },
                    { merge: true },
                );
                setAvatar(cred.user.photoURL || null);
            } else {
                setAvatar(
                    (snap.data() as any).avatar ?? cred.user.photoURL ?? null,
                );
            }
        } catch (err) {
            // failed to init user doc after Google login
            console.error(
                "[AuthContext] init user doc after Google login failed",
                err,
            );
        }
        return cred.user;
    };

    // New: Login with Naver using popup -> server -> custom token
    const handleDevProfileLogin = async (profile: any) => {
        // Dev-only helper: create a minimal "User-like" object and set into context.
        // This allows local testing of flows without Firebase Admin or real tokens.
        const fakeUser = {
            uid: `naver:${profile.id || "dev"}`,
            displayName: profile.name || profile.nickname || "Dev User",
            email: profile.email || null,
            photoURL: profile.profile_image || null,
        } as any;

        setUser(fakeUser as any);
        setAvatar(profile.profile_image || null);
        return fakeUser;
    };

    const loginWithNaver = async () => {
        const firebaseApp = getFirebaseAppOrNull();
        if (!firebaseApp) throw new Error("firebase_not_configured");
        const auth = getAuth(firebaseApp);

        // Generate and store state in localStorage to verify on callback
        const state =
            (crypto as any).randomUUID?.() ??
            Math.random().toString(36).slice(2);
        try {
            localStorage.setItem("naver_oauth_state", state);
        } catch (e) {}

        const url = `/api/auth/naver/start?return_to=${encodeURIComponent(
            window.location.origin,
        )}&state=${encodeURIComponent(state)}`;
        const result = await openPopupForProvider(url, "naver");

        // Dev bypass: result may be 'DEV:<json>'
        if (typeof result === "string" && result.startsWith("DEV:")) {
            if (process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS !== "true") {
                throw new Error(
                    "Dev auth bypass is not enabled on this client",
                );
            }
            const profileJson = JSON.parse(result.slice(4));
            const user = await handleDevProfileLogin(profileJson);
            return user;
        }

        // If result is an object with a customToken (direct server flow), sign in and persist profile if present
        if (
            result &&
            typeof result === "object" &&
            (result as any).customToken
        ) {
            const { customToken, profile } = result as any;
            const { signInWithCustomToken } = await import("firebase/auth");
            const cred = await signInWithCustomToken(auth, customToken);
            // Update Firebase Auth profile (displayName, photoURL) and email when provided
            try {
                const displayName = profile?.name || profile?.nickname || null;
                const photoURL = profile?.profile_image || null;
                if (displayName || photoURL) {
                    try {
                        await updateProfile(cred.user, {
                            displayName: displayName || undefined,
                            photoURL: photoURL || undefined,
                        });
                    } catch (err) {
                        console.warn("[AuthContext] updateProfile failed", err);
                    }
                }
                if (profile?.email) {
                    try {
                        await updateEmail(cred.user, profile.email);
                    } catch (err) {
                        console.warn("[AuthContext] updateEmail failed", err);
                    }
                }
                try {
                    await (cred.user as any).reload?.();
                } catch (err) {
                    console.warn("[AuthContext] user.reload failed", err);
                }
            } catch (err) {
                console.error(
                    "[AuthContext] Failed to update auth profile after Naver login",
                    err,
                );
            }
            setUser(cred.user);
            try {
                const db = getFirestore(firebaseApp);
                const docRef = doc(db, "users", cred.user.uid);
                await setDoc(
                    docRef,
                    {
                        avatar: profile?.profile_image || null,
                        displayName: profile?.name || profile?.nickname || null,
                        email: profile?.email || null,
                        createdAt: nowIsoString(),
                        updatedAt: nowIsoString(),
                        plan: "free",
                        aiCallUsage: 0,
                    },
                    { merge: true },
                );
                setAvatar(profile?.profile_image || null);
            } catch (err) {
                console.error(
                    "[AuthContext] Failed to init user doc after Naver login",
                    err,
                );
            }
            try {
                localStorage.removeItem("naver_oauth_state");
            } catch (e) {}
            return cred.user;
        }

        // If we got JSON with code/state, perform the exchange from the client
        if (typeof result === "string" && result.trim().startsWith("{")) {
            const parsed = JSON.parse(result);
            const { code, state: returnedState, returnTo } = parsed;
            const stored = localStorage.getItem("naver_oauth_state");
            if (!stored || stored !== returnedState) {
                throw new Error("OAuth state mismatch on client");
            }

            const resp = await fetch("/api/auth/naver/exchange", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code, state: returnedState, returnTo }),
            });
            if (!resp.ok) {
                const text = await resp.text().catch(() => "");
                throw new Error(`Exchange failed: ${resp.status} ${text}`);
            }
            const { customToken, profile } = await resp.json();
            if (!customToken)
                throw new Error("Exchange did not return a custom token");

            const { signInWithCustomToken } = await import("firebase/auth");
            const cred = await signInWithCustomToken(auth, customToken);
            // Update Firebase Auth profile (displayName/photoURL) and email when provided
            try {
                const displayName = profile?.name || profile?.nickname || null;
                const photoURL = profile?.profile_image || null;
                if (displayName || photoURL) {
                    try {
                        await updateProfile(cred.user, {
                            displayName: displayName || undefined,
                            photoURL: photoURL || undefined,
                        });
                    } catch (err) {
                        console.warn(
                            "[AuthContext] updateProfile failed (exchange)",
                            err,
                        );
                    }
                }
                if (profile?.email) {
                    try {
                        await updateEmail(cred.user, profile.email);
                    } catch (err) {
                        console.warn(
                            "[AuthContext] updateEmail failed (exchange)",
                            err,
                        );
                    }
                }
                try {
                    await (cred.user as any).reload?.();
                } catch (err) {
                    console.warn(
                        "[AuthContext] user.reload failed (exchange)",
                        err,
                    );
                }
            } catch (err) {
                console.error(
                    "[AuthContext] Failed to update auth profile after Naver login (exchange)",
                    err,
                );
            }
            setUser(cred.user);
            try {
                const db = getFirestore(firebaseApp);
                const docRef = doc(db, "users", cred.user.uid);
                await setDoc(
                    docRef,
                    {
                        avatar: profile?.profile_image || null,
                        displayName: profile?.name || profile?.nickname || null,
                        email: profile?.email || null,
                        createdAt: nowIsoString(),
                        updatedAt: nowIsoString(),
                        plan: "free",
                        aiCallUsage: 0,
                    },
                    { merge: true },
                );
                setAvatar(profile?.profile_image || null);
            } catch (err) {
                console.error(
                    "[AuthContext] Failed to init user doc after Naver login (exchange)",
                    err,
                );
            }
            try {
                localStorage.removeItem("naver_oauth_state");
            } catch (e) {}
            return cred.user;
        }

        // Otherwise assume older direct custom token flow
        const { signInWithCustomToken } = await import("firebase/auth");
        const cred = await signInWithCustomToken(auth, result as string);
        // Make sure Auth profile fields are reflected in Firebase Auth and Firestore
        try {
            const displayName = cred.user.displayName || null;
            const photoURL = cred.user.photoURL || null;
            if (displayName || photoURL) {
                try {
                    await updateProfile(cred.user, {
                        displayName: displayName || undefined,
                        photoURL: photoURL || undefined,
                    });
                } catch (err) {
                    console.warn(
                        "[AuthContext] updateProfile failed (fallback)",
                        err,
                    );
                }
            }
            if (cred.user.email) {
                try {
                    await updateEmail(cred.user, cred.user.email);
                } catch (err) {
                    console.warn(
                        "[AuthContext] updateEmail failed (fallback)",
                        err,
                    );
                }
            }
            try {
                await (cred.user as any).reload?.();
            } catch (err) {
                console.warn(
                    "[AuthContext] user.reload failed (fallback)",
                    err,
                );
            }
        } catch (err) {
            console.warn(
                "[AuthContext] Failed to update auth profile after fallback sign-in",
                err,
            );
        }

        setUser(cred.user);

        try {
            const db = getFirestore(firebaseApp);
            const docRef = doc(db, "users", cred.user.uid);
            const snap = await getDoc(docRef);
            const avatar = cred.user.photoURL || null;
            if (!snap.exists()) {
                await setDoc(
                    docRef,
                    {
                        avatar,
                        displayName: cred.user.displayName || null,
                        email: cred.user.email || null,
                        createdAt: nowIsoString(),
                        updatedAt: nowIsoString(),
                        plan: "free",
                        aiCallUsage: 0,
                    },
                    { merge: true },
                );
                setAvatar(avatar);
            } else {
                // ensure avatar present
                if (!snap.data()?.avatar && avatar) {
                    await setDoc(
                        docRef,
                        { avatar, updatedAt: nowIsoString() },
                        { merge: true },
                    );
                    setAvatar(avatar);
                } else {
                    setAvatar((snap.data() as any).avatar ?? avatar);
                }
            }
        } catch (err) {
            console.error(
                "[AuthContext] Failed to init user doc after fallback sign-in",
                err,
            );
        }

        return cred.user;
    };

    const loginWithKakao = async () => {
        const firebaseApp = getFirebaseAppOrNull();
        if (!firebaseApp) throw new Error("firebase_not_configured");
        const auth = getAuth(firebaseApp);

        // Generate and store state in localStorage to verify on callback (same pattern as Naver)
        const state =
            (crypto as any).randomUUID?.() ??
            Math.random().toString(36).slice(2);
        try {
            localStorage.setItem("kakao_oauth_state", state);
        } catch (e) {}

        const url = `/api/auth/kakao/start?return_to=${encodeURIComponent(
            window.location.origin,
        )}&state=${encodeURIComponent(state)}`;
        const result = await openPopupForProvider(url, "kakao");

        // Dev bypass: result may be 'DEV:<json>'
        if (typeof result === "string" && result.startsWith("DEV:")) {
            if (process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS !== "true") {
                throw new Error(
                    "Dev auth bypass is not enabled on this client",
                );
            }
            const profileJson = JSON.parse(result.slice(4));
            const user = await handleDevProfileLogin(profileJson);
            try {
                localStorage.removeItem("kakao_oauth_state");
            } catch (e) {}
            return user;
        }

        // Initialize to `null` so TypeScript won't report "used before assigned" when we
        // branch between direct server flow, code-exchange flow, or raw token string.
        let customToken: string | null = null;
        let profile: any = null;

        // Direct server flow (server returned customToken/profile)
        if (
            result &&
            typeof result === "object" &&
            (result as any).customToken
        ) {
            customToken = (result as any).customToken;
            profile = (result as any).profile || null;
        }

        // Code exchange flow (client receives code/state JSON and should call /api/auth/kakao/exchange)
        if (
            !customToken &&
            typeof result === "string" &&
            result.trim().startsWith("{")
        ) {
            const parsed = JSON.parse(result);
            const { code, state: returnedState, returnTo } = parsed;
            const stored = localStorage.getItem("kakao_oauth_state");
            if (!stored || stored !== returnedState) {
                throw new Error("OAuth state mismatch on client");
            }

            const resp = await fetch("/api/auth/kakao/exchange", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code, state: returnedState, returnTo }),
            });
            if (!resp.ok) {
                const text = await resp.text().catch(() => "");
                throw new Error(`Exchange failed: ${resp.status} ${text}`);
            }
            const json = await resp.json();
            customToken = json.customToken;
            profile = json.profile || null;
            try {
                localStorage.removeItem("kakao_oauth_state");
            } catch (e) {}
        }

        if (!customToken) {
            // Fallback: assume result is a raw custom token string
            customToken = String(result);
        }

        const { signInWithCustomToken } = await import("firebase/auth");
        const cred = await signInWithCustomToken(auth, customToken);
        // Update Firebase Auth profile and email when profile is provided
        try {
            if (profile) {
                // Normalize Kakao profile fields (provider returns different shapes)
                const kakaoEmail =
                    profile?.kakao_account?.email || profile?.email || null;
                const kakaoDisplayName =
                    profile?.kakao_account?.profile?.nickname ||
                    profile?.properties?.nickname ||
                    profile?.profile?.nickname ||
                    profile?.nickname ||
                    null;
                const kakaoAvatar =
                    profile?.kakao_account?.profile?.profile_image_url ||
                    profile?.properties?.profile_image ||
                    profile?.profile_image ||
                    profile?.profile?.profile_image ||
                    null;

                if (kakaoDisplayName || kakaoAvatar) {
                    try {
                        await updateProfile(cred.user, {
                            displayName: kakaoDisplayName || undefined,
                            photoURL: kakaoAvatar || undefined,
                        });
                    } catch (err) {
                        console.warn(
                            "[AuthContext] updateProfile failed (kakao)",
                            err,
                        );
                    }
                }
                if (kakaoEmail) {
                    try {
                        await updateEmail(cred.user, kakaoEmail);
                    } catch (err) {
                        console.warn(
                            "[AuthContext] updateEmail failed (kakao)",
                            err,
                        );
                    }
                }
                try {
                    await (cred.user as any).reload?.();
                } catch (err) {
                    console.warn(
                        "[AuthContext] user.reload failed (kakao)",
                        err,
                    );
                }

                const db = getFirestore(firebaseApp);
                const docRef = doc(db, "users", cred.user.uid);

                if (profile) {
                    await setDoc(
                        docRef,
                        {
                            avatar: kakaoAvatar,
                            displayName: kakaoDisplayName,
                            email: kakaoEmail,
                            createdAt: nowIsoString(),
                            updatedAt: nowIsoString(),
                            plan: "free",
                            aiCallUsage: 0,
                        },
                        { merge: true },
                    );
                    setAvatar(kakaoAvatar);
                } else {
                    const snap = await getDoc(docRef);
                    if (!snap.exists()) {
                        await setDoc(
                            docRef,
                            {
                                avatar: null,
                                createdAt: nowIsoString(),
                                updatedAt: nowIsoString(),
                                plan: "free",
                                aiCallUsage: 0,
                            },
                            { merge: true },
                        );
                        setAvatar(null);
                    } else {
                        setAvatar((snap.data() as any).avatar ?? null);
                    }
                }
            }
        } catch (err) {
            console.error(
                "[AuthContext] Failed to init user doc after Kakao login",
                err,
            );
        }

        return cred.user;
    };

    const logout = async () => {
        const firebaseApp = getFirebaseAppOrNull();
        if (!firebaseApp) {
            setUser(null);
            setAvatar(null);
            return;
        }
        const auth = getAuth(firebaseApp);
        try {
            await signOut(auth);
        } catch (err) {
            console.error("Failed to sign out", err);
            throw err;
        } finally {
            setUser(null);
            setAvatar(null);
            try {
                // Ensure the user is sent back to the main page after logout
                window.location.href = "/";
            } catch (e) {
                /* ignore */
            }
        }
    };

    const requestPasswordReset = async (email: string) => {
        const firebaseApp = getFirebaseAppOrNull();
        if (!firebaseApp) throw new Error("firebase_not_configured");
        const auth = getAuth(firebaseApp);
        try {
            console.info("[AuthContext] requestPasswordReset START", { email });
            // Use server-side endpoint to generate reset link and send via our email provider
            const res = await fetch("/api/auth/password-reset", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email }),
            });
            const result = await res.json().catch(() => null);
            if (!res.ok) {
                console.error("[AuthContext] requestPasswordReset failed", {
                    status: res.status,
                    body: result,
                });
                if (result && result.error === "server_misconfigured") {
                    // Fallback: try the Firebase client-side sendPasswordResetEmail as a short-term workaround
                    try {
                        await sendPasswordResetEmail(auth, email);
                        console.warn(
                            "[AuthContext] server misconfigured; used client fallback sendPasswordResetEmail",
                            { email },
                        );
                        return; // success via fallback
                    } catch (fallbackErr) {
                        console.error(
                            "[AuthContext] fallback sendPasswordResetEmail failed",
                            fallbackErr,
                        );
                        throw new Error("server_misconfigured");
                    }
                }
                if (result && result.error === "generate_link_failed") {
                    const id = result.eventId || "unknown";
                    throw new Error(`generate_link_failed:${id}`);
                }
                throw new Error("Failed to request password reset");
            }
            console.info("[AuthContext] requestPasswordReset SUCCESS", {
                email,
            });
        } catch (err) {
            console.error("[AuthContext] sendPasswordReset ERROR", err);
            throw err;
        }
    };

    const updateAvatar = async (dataUrl: string | null) => {
        const firebaseApp = getFirebaseAppOrNull();
        if (!firebaseApp) throw new Error("firebase_not_configured");
        const auth = getAuth(firebaseApp);
        if (!auth.currentUser) throw new Error("No authenticated user");
        const uid = auth.currentUser.uid;
        const online =
            typeof navigator !== "undefined" ? navigator.onLine : "unknown";
        // starting updateAvatar

        // helper to add a timeout around Firestore calls (to detect hangs)
        const withTimeout = <T,>(p: Promise<T>, ms: number) =>
            new Promise<T>((resolve, reject) => {
                let done = false;
                const timer = setTimeout(() => {
                    if (done) return;
                    done = true;
                    const err = new Error(`timeout after ${ms}ms`);
                    // attach some diagnostics
                    (err as any).diagnostics = {
                        uid,
                        size: dataUrl?.length ?? 0,
                    };
                    reject(err);
                }, ms);
                p.then((v) => {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    resolve(v);
                }).catch((e) => {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    reject(e);
                });
            });

        try {
            const db = getFirestore(firebaseApp);
            const docRef = doc(db, "users", uid);

            // prepare to write avatar to Firestore

            const start = Date.now();
            // helper to add a timeout around Firestore calls (to detect hangs)
            const withTimeout = <T,>(p: Promise<T>, ms: number) =>
                new Promise<T>((resolve, reject) => {
                    let done = false;
                    const timer = setTimeout(() => {
                        if (done) return;
                        done = true;
                        const err = new Error(`timeout after ${ms}ms`);
                        // attach some diagnostics
                        (err as any).diagnostics = {
                            uid,
                            size: dataUrl?.length ?? 0,
                        };
                        reject(err);
                    }, ms);
                    p.then((v) => {
                        if (done) return;
                        done = true;
                        clearTimeout(timer);
                        resolve(v);
                    }).catch((e) => {
                        if (done) return;
                        done = true;
                        clearTimeout(timer);
                        reject(e);
                    });
                });

            try {
                await withTimeout(
                    setDoc(
                        docRef,
                        { avatar: dataUrl, updatedAt: nowIsoString() },
                        { merge: true },
                    ),
                    15000,
                );
                const took = Date.now() - start;
            } catch (tErr) {
                console.error("[AuthContext] setDoc timed out or failed", tErr);
                throw tErr;
            }
            setAvatar(dataUrl);

            // Attempt to mirror to Firebase Auth photoURL (best-effort; may fail for large data)
            try {
                await updateProfile(auth.currentUser, { photoURL: dataUrl });
                // mirrored photoURL to Firebase Auth
            } catch (authErr) {
                console.warn(
                    "[AuthContext] updateProfile(photoURL) failed",
                    authErr,
                );
            }
        } catch (err) {
            console.error("[AuthContext] Failed to update avatar", err);
            // Try a single retry after enabling network (helps transient offline state)
            try {
                const db = getFirestore(firebaseApp);
                // attempt to enable network and retry
                await enableNetwork(db);
                const docRef = doc(db, "users", uid);
                await withTimeout(
                    setDoc(
                        docRef,
                        { avatar: dataUrl, updatedAt: nowIsoString() },
                        { merge: true },
                    ),
                    15000,
                );
                // retry succeeded
                setAvatar(dataUrl);
                return;
            } catch (retryErr) {
                console.error("[AuthContext] Retry failed", retryErr);
            }

            throw err;
        }
    };

    // Helper to remove undefined fields (Firestore rejects undefined values)
    function sanitizeForFirestore<T extends Record<string, any>>(obj: T): T {
        if (!obj || typeof obj !== "object") return obj;
        const out: any = Array.isArray(obj) ? [] : {};
        for (const key of Object.keys(obj)) {
            const val = (obj as any)[key];
            if (val === undefined) continue; // skip undefined
            if (val && typeof val === "object" && !Array.isArray(val)) {
                out[key] = sanitizeForFirestore(val);
            } else {
                out[key] = val;
            }
        }
        return out as T;
    }

    const updateSubscription = async (
        data: import("@/lib/subscription").SubscriptionData,
    ) => {
        const firebaseApp = getFirebaseAppOrNull();
        if (!firebaseApp) throw new Error("firebase_not_configured");
        const auth = getAuth(firebaseApp);
        if (!auth.currentUser) throw new Error("No authenticated user");
        const uid = auth.currentUser.uid;

        const sanitized = sanitizeForFirestore(data as any);

        const withTimeout = <T,>(p: Promise<T>, ms: number) =>
            new Promise<T>((resolve, reject) => {
                let done = false;
                const timer = setTimeout(() => {
                    if (done) return;
                    done = true;
                    const err = new Error(`timeout after ${ms}ms`);
                    (err as any).diagnostics = {
                        uid,
                        size: JSON.stringify(sanitized).length,
                    };
                    reject(err);
                }, ms);
                p.then((v) => {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    resolve(v);
                }).catch((e) => {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    reject(e);
                });
            });

        try {
            const db = getFirestore(firebaseApp);
            const docRef = doc(db, "users", uid);
            const start = Date.now();
            try {
                await withTimeout(
                    setDoc(
                        docRef,
                        {
                            subscription: sanitized,
                            plan:
                                (sanitized.plan as
                                    | "free"
                                    | "go"
                                    | "plus"
                                    | "pro"
                                    | "test"
                                    | undefined) || "free",
                            updatedAt: nowIsoString(),
                        },
                        { merge: true },
                    ),
                    15000,
                );
                const took = Date.now() - start;
                console.log(
                    `[AuthContext] subscription saved for ${uid} (${took}ms)`,
                );
            } catch (tErr) {
                console.error(
                    "[AuthContext] setDoc subscription timed out or failed",
                    tErr,
                );
                throw tErr;
            }
        } catch (err) {
            console.error("[AuthContext] Failed to update subscription", err);
            try {
                const db = getFirestore(firebaseApp);
                await enableNetwork(db);
                const docRef = doc(db, "users", uid);
                await withTimeout(
                    setDoc(
                        docRef,
                        {
                            subscription: sanitized,
                            plan:
                                (sanitized.plan as
                                    | "free"
                                    | "go"
                                    | "plus"
                                    | "pro"
                                    | "test"
                                    | undefined) || "free",
                            updatedAt: nowIsoString(),
                        },
                        { merge: true },
                    ),
                    15000,
                );
                console.log(
                    `[AuthContext] subscription saved for ${uid} after retry`,
                );
                return;
            } catch (retryErr) {
                console.error(
                    "[AuthContext] Retry failed for subscription",
                    retryErr,
                );
            }

            throw err;
        }
    };

    const isAuthenticated = !!user;

    return (
        <AuthContext.Provider
            value={{
                user,
                loading,
                avatar,
                loginWithEmail,
                signupWithEmail,
                loginWithGoogle,
                loginWithNaver,
                loginWithKakao,
                requestPasswordReset,
                updateAvatar,
                updateSubscription,
                logout,
                isAuthenticated,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
