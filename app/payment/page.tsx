import { redirect } from "next/navigation";

type PaymentPageProps = {
    searchParams?: {
        amount?: string;
        orderName?: string;
        billingCycle?: string;
        recurring?: string;
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

    redirect(`/?${homeParams.toString()}`);
}
