import { redirect } from "next/navigation";

type PaymentPageProps = {
    searchParams?: {
        amount?: string;
        orderName?: string;
        billingCycle?: string;
        recurring?: string;
        purchaseType?: string;
        tokenPackTier?: string;
    };
};

export default function PaymentPage({ searchParams }: PaymentPageProps) {
    const amount = searchParams?.amount;
    const orderName = searchParams?.orderName;

    if (!amount || !orderName) {
        redirect("/");
    }

    const homeParams = new URLSearchParams({
        openPayment: "true",
        amount,
        orderName,
    });

    if (searchParams?.billingCycle) {
        homeParams.set("billingCycle", searchParams.billingCycle);
    }

    if (searchParams?.recurring) {
        homeParams.set("recurring", searchParams.recurring);
    }

    if (searchParams?.purchaseType) {
        homeParams.set("purchaseType", searchParams.purchaseType);
    }

    if (searchParams?.tokenPackTier) {
        homeParams.set("tokenPackTier", searchParams.tokenPackTier);
    }

    redirect(`/?${homeParams.toString()}`);
}
