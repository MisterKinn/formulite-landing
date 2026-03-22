"use client";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { ENABLE_UPDATE_NOTICE } from "@/lib/featureFlags";
import billingUpdatePopupImage from "../nova-ai/2.1.1.png";
import serverUpdatePopupImage from "../nova-ai/update.png";

const EVENT_POPUPS = [
    {
        id: "billing-update-211",
        storageKey: "eventPopupHideUntil:billing-update-211",
        image: billingUpdatePopupImage,
        alt: "결제 및 업데이트 공지",
    },
    {
        id: "server-update-20260322",
        storageKey: "eventPopupHideUntil:server-update-20260322",
        image: serverUpdatePopupImage,
        alt: "서버 업데이트 공지",
    },
] as const;

type EventPopupItem = (typeof EVENT_POPUPS)[number];

export default function EventPopup() {
    const [visiblePopupIds, setVisiblePopupIds] = useState<string[]>([]);
    const [isScrollHidden, setIsScrollHidden] = useState(false);

    useEffect(() => {
        try {
            const nextVisiblePopups = EVENT_POPUPS.filter((popup) => {
                const hideUntil = localStorage.getItem(popup.storageKey);
                return !hideUntil || Date.now() >= Number(hideUntil);
            }).map((popup) => popup.id);

            setVisiblePopupIds(nextVisiblePopups);
        } catch {
            setVisiblePopupIds(EVENT_POPUPS.map((popup) => popup.id));
        }
    }, []);

    const visiblePopups = useMemo(
        () => EVENT_POPUPS.filter((popup) => visiblePopupIds.includes(popup.id)),
        [visiblePopupIds],
    );

    const isVisible = visiblePopups.length > 0;

    useEffect(() => {
        if (!isVisible || typeof window === "undefined") return;

        const topRevealOffset = 80;

        const handleScroll = () => {
            const currentScrollY = window.scrollY;

            if (currentScrollY <= topRevealOffset) {
                setIsScrollHidden(false);
            } else {
                setIsScrollHidden(true);
            }
        };

        handleScroll();
        window.addEventListener("scroll", handleScroll, { passive: true });

        return () => window.removeEventListener("scroll", handleScroll);
    }, [isVisible]);

    const closePopup = (popupId: EventPopupItem["id"]) => {
        setVisiblePopupIds((prev) => prev.filter((id) => id !== popupId));
    };

    const handleClose = (popupId: EventPopupItem["id"], e: MouseEvent) => {
        e.stopPropagation();
        closePopup(popupId);
    };

    const handleTodayClose = (popup: EventPopupItem, e: MouseEvent) => {
        e.stopPropagation();
        closePopup(popup.id);
        try {
            const now = new Date();
            const endOfDay = new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate() + 1,
            ).getTime();
            localStorage.setItem(popup.storageKey, String(endOfDay));
        } catch {
            // Ignore storage access failures and just close the popup.
        }
    };

    if (!ENABLE_UPDATE_NOTICE) return null;
    if (!isVisible) return null;

    return (
        <div
            className={`event-popup-overlay ${isScrollHidden ? "event-popup-overlay--hidden" : ""}`}
        >
            <div className="event-popup-stack">
                {visiblePopups.map((popup) => (
                    <div
                        key={popup.id}
                        className="event-popup-container"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <img
                            src={popup.image.src}
                            alt={popup.alt}
                            className="event-popup-image"
                        />
                        <div className="event-popup-bottom">
                            <button
                                className="event-popup-today-btn"
                                onClick={(e) => handleTodayClose(popup, e)}
                            >
                                오늘 하루 보지 않기
                            </button>
                            <button
                                className="event-popup-close-btn"
                                onClick={(e) => handleClose(popup.id, e)}
                            >
                                닫기
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
