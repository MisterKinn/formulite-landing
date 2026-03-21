"use client";
import { useEffect, useState, type MouseEvent } from "react";
import { ENABLE_UPDATE_NOTICE } from "@/lib/featureFlags";
import updatePopupImage from "../nova-ai/2.1.1.png";

export default function EventPopup() {
    const [visible, setVisible] = useState(false);
    const [isScrollHidden, setIsScrollHidden] = useState(false);

    useEffect(() => {
        try {
            const hideUntil = localStorage.getItem("eventPopupHideUntil");
            if (hideUntil && Date.now() < Number(hideUntil)) {
                return;
            }
            setVisible(true);
        } catch {
            setVisible(true);
        }
    }, []);

    useEffect(() => {
        if (!visible || typeof window === "undefined") return;

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
    }, [visible]);

    const handleClose = (e: MouseEvent) => {
        e.stopPropagation();
        setVisible(false);
    };

    const handleTodayClose = (e: MouseEvent) => {
        e.stopPropagation();
        setVisible(false);
        try {
            const now = new Date();
            const endOfDay = new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate() + 1,
            ).getTime();
            localStorage.setItem("eventPopupHideUntil", String(endOfDay));
        } catch {
            // Ignore storage access failures and just close the popup.
        }
    };

    if (!ENABLE_UPDATE_NOTICE) return null;
    if (!visible) return null;

    return (
        <div
            className={`event-popup-overlay ${isScrollHidden ? "event-popup-overlay--hidden" : ""}`}
        >
            <div className="event-popup-container" onClick={(e) => e.stopPropagation()}>
                <img
                    src={updatePopupImage.src}
                    alt="결제 및 업데이트 공지"
                    className="event-popup-image"
                />
                <div className="event-popup-bottom">
                    <button className="event-popup-today-btn" onClick={handleTodayClose}>
                        오늘 하루 보지 않기
                    </button>
                    <button className="event-popup-close-btn" onClick={handleClose}>
                        닫기
                    </button>
                </div>
            </div>
        </div>
    );
}
