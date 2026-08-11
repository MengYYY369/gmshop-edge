import type {
	PaymentProvider,
	PaymentProviderAdapter,
} from "#/features/shop-payments/provider";
import { DomainError } from "#/lib/domain-error";
import { createAutomaticAlipayProvider } from "./alipay";
import { cryptomusPaymentProvider } from "./cryptomus";
import { epayPaymentProvider } from "./epay";
import { epayV1PaymentProvider } from "./epay-v1";
import { gmpayPaymentProvider } from "./gmpay";
import { paypalPaymentProvider } from "./paypal";
import { stripePaymentProvider } from "./stripe";
import { createAutomaticWechatPayProvider } from "./wechatpay";

const automaticAlipayProvider = createAutomaticAlipayProvider();
const automaticWechatPayProvider = createAutomaticWechatPayProvider();

const providers: Record<PaymentProvider, PaymentProviderAdapter> = {
	stripe: stripePaymentProvider,
	cryptomus: cryptomusPaymentProvider,
	gmpay: gmpayPaymentProvider,
	epay: epayPaymentProvider,
	epay_v1: epayV1PaymentProvider,
	paypal: paypalPaymentProvider,
	alipay_page: automaticAlipayProvider,
	alipay_wap: automaticAlipayProvider,
	wechat_native: automaticWechatPayProvider,
	wechat_h5: automaticWechatPayProvider,
};

export function getPaymentProvider(provider: string) {
	const adapter = providers[provider as PaymentProvider];
	if (!adapter)
		throw new DomainError(
			"payment_provider_unsupported",
			400,
			"Unsupported payment provider",
		);
	return adapter;
}

export function paymentCheckoutPresentation(
	provider: string,
	checkoutUrl?: string | null,
) {
	if ((provider === "wechat_native" || provider === "wechat_h5") && checkoutUrl)
		return checkoutUrl.startsWith("weixin://") ? "qr" : "redirect";
	return getPaymentProvider(provider).checkoutPresentation;
}
