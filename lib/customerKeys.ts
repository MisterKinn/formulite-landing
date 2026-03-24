const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array | null {
    if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
        return null;
    }

    const bytes = new Uint8Array(hex.length / 2);
    for (let index = 0; index < hex.length; index += 2) {
        bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
    }
    return bytes;
}

function decodeHexUserId(encoded: string): string | null {
    try {
        const bytes = hexToBytes(encoded);
        if (!bytes) return null;
        return textDecoder.decode(bytes);
    } catch {
        return null;
    }
}

export function buildCustomerKey(userId: string, suffix?: string | number): string {
    const encodedUserId = bytesToHex(textEncoder.encode(userId));
    if (suffix === undefined || suffix === null || suffix === "") {
        return `userhex_${encodedUserId}`;
    }
    return `userhex_${encodedUserId}_${String(suffix)}`;
}

export function extractUserIdFromCustomerKey(customerKey?: string | null): string | null {
    if (!customerKey || typeof customerKey !== "string") return null;

    const encodedMatch = customerKey.match(/^userhex_([0-9a-f]+)(?:_.+)?$/i);
    if (encodedMatch?.[1]) {
        return decodeHexUserId(encodedMatch[1]);
    }

    if (customerKey.startsWith("user_")) {
        const legacyWithSuffixMatch = customerKey.match(/^user_(.+)_(\d{10,})$/);
        if (legacyWithSuffixMatch?.[1]) {
            return legacyWithSuffixMatch[1];
        }
        return customerKey.slice("user_".length) || null;
    }

    const customerMatch = customerKey.match(/^customer_(.+)_\d{10,}$/);
    if (customerMatch?.[1]) {
        return customerMatch[1];
    }

    if (customerKey.length >= 20 && !customerKey.includes("@")) {
        return customerKey;
    }

    return null;
}
