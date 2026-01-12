"use client";
import React, { createContext, useContext, useEffect, useState } from "react";
import {
    getAuth,
    onAuthStateChanged,
    User,
    updateProfile,
    signOut,
} from "firebase/auth";
import { app } from "../firebaseConfig";
import {
    getFirestore,
    doc,
    getDoc,
    setDoc,
    enableNetwork,
} from "firebase/firestore";

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
        displayName?: string
    ) => Promise<User>;
    loginWithGoogle: () => Promise<User>;
    loginWithNaver: () => Promise<User>;
    loginWithKakao: () => Promise<User>;
    requestPasswordReset: (email: string) => Promise<void>;
    updateAvatar: (dataUrl: string | null) => Promise<void>;
    updateSubscription: (
        data: import("@/lib/subscription").SubscriptionData
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

    useEffect(() => {
        const auth = getAuth(app);
        const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
            setUser(firebaseUser);
            setLoading(false);
            // load avatar from Firestore when user signs in
            (async () => {
                try {
                    if (firebaseUser) {
                        const db = getFirestore(app);
                        const docRef = doc(db, "users", firebaseUser.uid);
                        const snap = await getDoc(docRef);
                        if (snap.exists()) {
                            const data = snap.data() as any;
                            setAvatar(data?.avatar ?? null);
                        } else {
                            setAvatar(null);
                        }
                    } else {
                        setAvatar(null);
                    }
                } catch (err) {
                    setAvatar(null);
                }
            })();
        });
        return () => unsubscribe();
    }, []);

    // Auth methods
    const loginWithEmail = async (email: string, password: string) => {
        const auth = getAuth(app);
        try {
            const cred = await signInWithEmailAndPassword(
                auth,
                email,
                password
            );
            setUser(cred.user);
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
                    err
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
        displayName?: string
    ) => {
        const auth = getAuth(app);
        const cred = await createUserWithEmailAndPassword(
            auth,
            email,
            password
        );
        if (displayName) {
            await updateProfile(cred.user, { displayName });
        }
        setUser(cred.user);
        // create initial Firestore user doc
        try {
            const db = getFirestore(app);
            const docRef = doc(db, "users", cred.user.uid);
            await setDoc(
                docRef,
                { avatar: null, createdAt: Date.now() },
                { merge: true }
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
        timeout = 120000
    ) =>
        new Promise<string>((resolve, reject) => {
            const w = window.open(
                url,
                `${provider}-auth`,
                "width=500,height=700"
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
                    // Only accept messages from same origin
                    if (e.origin !== window.location.origin) return;
                    const data = e.data;
                    if (
                        !data ||
                        data.type !== "oauth" ||
                        data.provider !== provider
                    )
                        return;
                    clearTimeout(timer);
                    window.removeEventListener("message", handler);
                    try {
                        if (w && typeof (w as any).close === "function")
                            (w as any).close();
                    } catch (e) {}
                    if (data.customToken) {
                        resolve(String(data.customToken));
                        return;
                    }
                    reject(new Error("No custom token returned"));
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
        const auth = getAuth(app);
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
                    "auth/operation-not-supported-in-this-environment"
                )
            ) {
                try {
                    console.info(
                        "[AuthContext] Falling back to signInWithRedirect for Google sign-in"
                    );
                    // initiates redirect; app will reload and onAuthStateChanged will pick up the logged-in user
                    await import("firebase/auth").then(
                        ({ signInWithRedirect }) =>
                            signInWithRedirect(auth, provider)
                    );
                    // return a promise that never resolves here because redirect will navigate away
                    return new Promise(() => {});
                } catch (redirectErr) {
                    console.error(
                        "[AuthContext] signInWithRedirect failed",
                        redirectErr
                    );
                    throw redirectErr;
                }
            }

            // Otherwise rethrow the original error for the UI to show a friendly message
            throw err;
        }

        // load or create Firestore user doc for avatar
        try {
            const db = getFirestore(app);
            const docRef = doc(db, "users", cred.user.uid);
            const snap = await getDoc(docRef);
            if (!snap.exists()) {
                await setDoc(
                    docRef,
                    { avatar: null, createdAt: Date.now() },
                    { merge: true }
                );
                setAvatar(null);
            } else {
                setAvatar((snap.data() as any).avatar ?? null);
            }
        } catch (err) {
            // failed to init user doc after Google login
            console.error(
                "[AuthContext] init user doc after Google login failed",
                err
            );
        }
        return cred.user;
    };

    // New: Login with Naver using popup -> server -> custom token
    const loginWithNaver = async () => {
        const auth = getAuth(app);
        const url = `/api/auth/naver/start?return_to=${encodeURIComponent(
            window.location.origin
        )}`;
        const customToken = await openPopupForProvider(url, "naver");
        const { signInWithCustomToken } = await import("firebase/auth");
        const cred = await signInWithCustomToken(auth, customToken);
        setUser(cred.user);

        // initialize Firestore user doc
        try {
            const db = getFirestore(app);
            const docRef = doc(db, "users", cred.user.uid);
            const snap = await getDoc(docRef);
            if (!snap.exists()) {
                await setDoc(
                    docRef,
                    { avatar: null, createdAt: Date.now() },
                    { merge: true }
                );
                setAvatar(null);
            } else {
                setAvatar((snap.data() as any).avatar ?? null);
            }
        } catch (err) {
            console.error(
                "[AuthContext] Failed to init user doc after Naver login",
                err
            );
        }

        return cred.user;
    };

    const loginWithKakao = async () => {
        const auth = getAuth(app);
        const url = `/api/auth/kakao/start?return_to=${encodeURIComponent(
            window.location.origin
        )}`;
        const customToken = await openPopupForProvider(url, "kakao");
        const { signInWithCustomToken } = await import("firebase/auth");
        const cred = await signInWithCustomToken(auth, customToken);
        setUser(cred.user);

        try {
            const db = getFirestore(app);
            const docRef = doc(db, "users", cred.user.uid);
            const snap = await getDoc(docRef);
            if (!snap.exists()) {
                await setDoc(
                    docRef,
                    { avatar: null, createdAt: Date.now() },
                    { merge: true }
                );
                setAvatar(null);
            } else {
                setAvatar((snap.data() as any).avatar ?? null);
            }
        } catch (err) {
            console.error(
                "[AuthContext] Failed to init user doc after Kakao login",
                err
            );
        }

        return cred.user;
    };

    const logout = async () => {
        const auth = getAuth(app);
        try {
            await signOut(auth);
        } catch (err) {
            console.error("Failed to sign out", err);
            throw err;
        } finally {
            setUser(null);
            setAvatar(null);
        }
    };

    const requestPasswordReset = async (email: string) => {
        const auth = getAuth(app);
        try {
            console.info("[AuthContext] sendPasswordReset START", { email });
            await sendPasswordResetEmail(auth, email);
            console.info("[AuthContext] sendPasswordReset SUCCESS", { email });
        } catch (err) {
            console.error("[AuthContext] sendPasswordReset ERROR", err);
            throw err;
        }
    };

    const updateAvatar = async (dataUrl: string | null) => {
        const auth = getAuth(app);
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
            const db = getFirestore(app);
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
                    setDoc(docRef, { avatar: dataUrl }, { merge: true }),
                    15000
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
                    authErr
                );
            }
        } catch (err) {
            console.error("[AuthContext] Failed to update avatar", err);
            // Try a single retry after enabling network (helps transient offline state)
            try {
                const db = getFirestore(app);
                // attempt to enable network and retry
                await enableNetwork(db);
                const docRef = doc(db, "users", uid);
                await withTimeout(
                    setDoc(docRef, { avatar: dataUrl }, { merge: true }),
                    15000
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
        data: import("@/lib/subscription").SubscriptionData
    ) => {
        const auth = getAuth(app);
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
            const db = getFirestore(app);
            const docRef = doc(db, "users", uid);
            const start = Date.now();
            try {
                await withTimeout(
                    setDoc(
                        docRef,
                        { subscription: sanitized },
                        { merge: true }
                    ),
                    15000
                );
                const took = Date.now() - start;
                console.log(
                    `[AuthContext] subscription saved for ${uid} (${took}ms)`
                );
            } catch (tErr) {
                console.error(
                    "[AuthContext] setDoc subscription timed out or failed",
                    tErr
                );
                throw tErr;
            }
        } catch (err) {
            console.error("[AuthContext] Failed to update subscription", err);
            try {
                const db = getFirestore(app);
                await enableNetwork(db);
                const docRef = doc(db, "users", uid);
                await withTimeout(
                    setDoc(
                        docRef,
                        { subscription: sanitized },
                        { merge: true }
                    ),
                    15000
                );
                console.log(
                    `[AuthContext] subscription saved for ${uid} after retry`
                );
                return;
            } catch (retryErr) {
                console.error(
                    "[AuthContext] Retry failed for subscription",
                    retryErr
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
