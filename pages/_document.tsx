import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
    return (
        <Html>
            <Head>
                {/* TossPayments SDK v2 스크립트 강제 삽입 */}
                <script src="https://js.tosspayments.com/v2/standard"></script>
            </Head>
            <body>
                <Main />
                <NextScript />
            </body>
        </Html>
    );
}
