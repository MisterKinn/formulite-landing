"use client";
import { useEffect, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";

export default function EventPopup() {
    const [visible, setVisible] = useState(false);
    const router = useRouter();

    useEffect(() => {
        try {
            const hideUntil = localStorage.getItem("eventPopupHideUntil");
            if (hideUntil && Date.now() < Number(hideUntil)) {
                return;
            }

            const dismissed = sessionStorage.getItem("eventPopupDismissed");
            if (!dismissed) {
                setVisible(true);
            }
        } catch {
            setVisible(true);
        }
    }, []);

    const handleClose = (e: MouseEvent) => {
        e.stopPropagation();
        setVisible(false);
        try {
            sessionStorage.setItem("eventPopupDismissed", "true");
        } catch {
            // Ignore storage access failures and just close the popup.
        }
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
            sessionStorage.setItem("eventPopupDismissed", "true");
        } catch {
            // Ignore storage access failures and just close the popup.
        }
    };

    const handleImageClick = () => {
        setVisible(false);
        try {
            sessionStorage.setItem("eventPopupDismissed", "true");
        } catch {
            // Ignore storage access failures and continue navigation.
        }
        router.push("/notices/1");
    };

    if (!visible) return null;

    return (
        <div className="event-popup-overlay" onClick={handleClose}>
            <div className="event-popup-container" onClick={(e) => e.stopPropagation()}>
                <img
                    src="/event.png"
                    alt="결제 및 업데이트 공지"
                    className="event-popup-image"
                    onClick={handleImageClick}
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
