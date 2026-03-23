function parseAdminEmails(rawValue: string | undefined) {
    return Array.from(
        new Set(
            String(rawValue || "")
                .split(/[,\s]+/)
                .map((value) => value.trim().toLowerCase())
                .filter(Boolean),
        ),
    );
}

const publicAdminEmails = parseAdminEmails(
    process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL,
);

export const ADMIN_EMAILS = publicAdminEmails;
export const ADMIN_EMAIL = ADMIN_EMAILS[0] || "";

export const ADMIN_SESSION_STORAGE_KEY = "nova_admin_session_token";
