"use client";
import React, { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getAuth, updateProfile } from "firebase/auth";
import { useAuth } from "../../context/AuthContext";
import "./profile.css";
import "../login/login.css";
import "../style.css";
import "../mobile.css";

import { Navbar } from "../../components/Navbar";
import dynamic from "next/dynamic";
const Sidebar = dynamic(() => import("../../components/Sidebar"), {
    ssr: false,
});

export default function ProfilePage() {
    const router = useRouter();
    const {
        user: authUser,
        avatar: authAvatar,
        updateAvatar,
        logout,
    } = useAuth();

    const [displayName, setDisplayName] = useState("");
    const [email, setEmail] = useState("");
    const [preview, setPreview] = useState<string | null>(null);
    const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
    const [removingPhoto, setRemovingPhoto] = useState(false);
    const [processingImage, setProcessingImage] = useState(false);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (authUser) {
            setEmail(authUser.email || "");
            setDisplayName(authUser.displayName || "");
            setPreview(authAvatar || null);
            setPhotoDataUrl(null);
            setRemovingPhoto(false);
        } else {
            setEmail("");
            setDisplayName("");
            setPreview(null);
            setPhotoDataUrl(null);
            setRemovingPhoto(false);
        }
    }, [authUser, authAvatar]);

    const fileInputRef = useRef<HTMLInputElement>(null);

    // Convert File -> (resized/compressed) Data URL
    const fileToDataUrl = (file: File): Promise<string> =>
        new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result as string;
                const img = new Image();
                img.onload = () => {
                    try {
                        const maxDim = 384;
                        let { width, height } = img;
                        if (width > maxDim || height > maxDim) {
                            const ratio = width / height;
                            if (ratio > 1) {
                                width = maxDim;
                                height = Math.round(maxDim / ratio);
                            } else {
                                height = maxDim;
                                width = Math.round(maxDim * ratio);
                            }
                        }
                        const canvas = document.createElement("canvas");
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext("2d");
                        if (!ctx) throw new Error("Cannot get canvas context");
                        ctx.drawImage(img, 0, 0, width, height);
                        const compressed = canvas.toDataURL("image/jpeg", 0.6);
                        const dataUrl =
                            compressed.length < result.length
                                ? compressed
                                : result;
                        resolve(dataUrl);
                    } catch (err) {
                        resolve(result);
                    }
                };
                img.onerror = () => reject(new Error("Image load error"));
                img.src = result;
            };
            reader.onerror = () => reject(new Error("File read error"));
            reader.readAsDataURL(file);
        });

    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setError(null);
        setStatus(null);
        setProcessingImage(true);
        try {
            const dataUrl = await fileToDataUrl(file);
            if (dataUrl.length > 800_000) {
                setError(
                    "이미지 크기가 너무 큽니다. 더 작은 이미지를 사용해주세요 (약 800KB 이하 권장)."
                );
                setProcessingImage(false);
                return;
            }
            setPreview(dataUrl);
            setPhotoDataUrl(dataUrl);
            setRemovingPhoto(false);
        } catch (err) {
            console.error(err);
            setError("이미지를 처리하지 못했습니다.");
        } finally {
            setProcessingImage(false);
            if (e.target) e.target.value = "";
        }
    };

    const handleClearPhoto = () => {
        setPhotoDataUrl(null);
        setPreview(null);
        setRemovingPhoto(true);
    };

    const handleSubmit = (ev: React.FormEvent) => {
        ev.preventDefault();
        if (processingImage) {
            setError("이미지 처리가 완료될 때까지 기다려 주세요.");
            return;
        }
        setSaving(true);
        setError(null);
        setStatus(null);

        if (!authUser) {
            setError("Not authenticated");
            setSaving(false);
            return;
        }

        // Navigate immediately, then save profile changes in background.
        router.push("/");

        (async () => {
            try {
                const auth = getAuth();
                if (auth.currentUser) {
                    try {
                        await updateProfile(auth.currentUser, { displayName });
                        await auth.currentUser.reload();
                        // update local state if still mounted
                        try {
                            setDisplayName(auth.currentUser.displayName || "");
                        } catch {}
                    } catch (err) {
                        console.error(
                            "Failed to update displayName (background)",
                            err
                        );
                    }
                }

                try {
                    await updateAvatar(removingPhoto ? null : photoDataUrl);
                } catch (err) {
                    console.error("Failed to update avatar (background)", err);
                }
            } catch (err) {
                console.error("Profile background save failed", err);
            }
        })();

        // Immediately stop the local saving state since we've redirected.
        setSaving(false);
        setStatus("프로필이 업데이트되었습니다.");
    };

    const initial = (displayName || "").trim().charAt(0).toUpperCase();
    const handleLogout = async () => {
        try {
            await logout();
            setStatus("로그아웃 되었습니다.");
            router.push("/login");
        } catch (err) {
            console.error("Logout failed", err);
            setError("로그아웃 중 문제가 발생했습니다.");
        }
    };

    return (
        <>
            <div className="desktop-navbar">
                <Navbar />
            </div>
            <div className="mobile-sidebar-container">
                <Sidebar />
            </div>

            <div className="profile-page">
                <div className="profile-card">
                    <header className="profile-header">
                        <Link href="/" className="back-link">
                            <span>← 메인으로 돌아가기</span>
                        </Link>
                        <div>
                            <p className="eyebrow">Account</p>
                            <h1>프로필 관리</h1>
                        </div>
                    </header>

                    <form className="profile-form" onSubmit={handleSubmit}>
                        <div className="avatar-field">
                            {preview ? (
                                <img src={preview} alt="미리보기" />
                            ) : (
                                <div className="avatar-placeholder">
                                    {initial}
                                </div>
                            )}

                            <div className="avatar-actions">
                                <label className="ghost-btn">
                                    사진 업로드
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={handleFile}
                                        ref={fileInputRef}
                                        disabled={processingImage || saving}
                                    />
                                </label>
                                <button
                                    type="button"
                                    className="text-btn"
                                    onClick={handleClearPhoto}
                                >
                                    사진 제거
                                </button>
                            </div>
                        </div>

                        <label>
                            <span>표시 이름</span>
                            <div className="input-shell">
                                <svg
                                    width="18"
                                    height="18"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    style={{ marginRight: "4px" }}
                                >
                                    <circle cx="12" cy="8" r="4" />
                                    <path d="M6 20c0-2.21 3.58-4 6-4s6 1.79 6 4" />
                                </svg>
                                <input
                                    type="text"
                                    value={displayName}
                                    onChange={(e) =>
                                        setDisplayName(e.target.value)
                                    }
                                    placeholder="이름을 입력해주세요"
                                />
                            </div>
                        </label>

                        <label>
                            <span>이메일</span>
                            <div className="input-shell">
                                <svg
                                    width="18"
                                    height="18"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    style={{ marginRight: "4px" }}
                                >
                                    <rect
                                        x="2"
                                        y="4"
                                        width="20"
                                        height="16"
                                        rx="2"
                                    />
                                    <path d="m22 6-10 7L2 6" />
                                </svg>
                                <input
                                    type="email"
                                    value={email || ""}
                                    disabled
                                />
                            </div>
                        </label>

                        {error && (
                            <div className="profile-banner error">{error}</div>
                        )}
                        {status && (
                            <div className="profile-banner success">
                                {status}
                            </div>
                        )}

                        <section
                            className="profile-tier redesigned-tier"
                            aria-label="요금제 정보"
                        >
                            <div className="tier-left">
                                <span className="current-tier-badge">
                                    현재 요금제
                                </span>
                                <span className="current-tier-name">무료</span>
                            </div>
                            <div className="tier-right">
                                <button
                                    type="button"
                                    className="upgrade-btn tier-upgrade-btn"
                                    aria-label="업그레이드 하기"
                                >
                                    업그레이드
                                </button>
                            </div>
                        </section>

                        <button
                            type="submit"
                            className="save-btn"
                            disabled={saving || processingImage}
                        >
                            {saving
                                ? "저장 중..."
                                : processingImage
                                ? "이미지 처리 중..."
                                : "변경 사항 저장"}
                        </button>
                        <div className="profile-reset-row"></div>
                    </form>

                    <div className="profile-footer">
                        <div className="profile-footer-btns">
                            <button
                                type="button"
                                className="ghost-btn profile-reset-btn"
                                onClick={() =>
                                    (window.location.href = "/password-reset")
                                }
                            >
                                비밀번호 재설정
                            </button>
                            <button
                                type="button"
                                className="ghost-btn"
                                onClick={handleLogout}
                            >
                                로그아웃
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
