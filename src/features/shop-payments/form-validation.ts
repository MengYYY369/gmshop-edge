import type { z } from "zod";
import type { ProFormFieldErrors } from "#/components/pro/form";
import { paymentChannelInputSchema } from "#/features/shop-payments/schema";
import { m } from "#/paraglide/messages";

type PaymentChannelInput = z.input<typeof paymentChannelInputSchema>;

export function paymentChannelFormErrors(
	input: PaymentChannelInput,
): ProFormFieldErrors {
	const result = paymentChannelInputSchema.safeParse(input);
	if (result.success) return {};

	const errors: ProFormFieldErrors = {};
	for (const issue of result.error.issues) {
		const field = issue.path[0];
		if (typeof field !== "string" || errors[field]) continue;
		errors[field] = [paymentChannelFieldError(field, input.provider)];
	}
	return errors;
}

function paymentChannelFieldError(field: string, provider: string) {
	switch (field) {
		case "name":
			return m.payment_channels_validation_name();
		case "currency":
			return provider === "alipay_page" ||
				provider === "alipay_wap" ||
				provider === "wechat_native" ||
				provider === "wechat_h5"
				? m.payment_channels_validation_cny_currency()
				: m.payment_channels_validation_currency();
		case "feeBps":
			return m.payment_channels_validation_fee_bps();
		case "fixedFeeMinor":
			return m.payment_channels_validation_fixed_fee();
		case "defaultToken":
		case "defaultNetwork":
			return m.payment_channels_validation_asset_pair();
		case "stripeSecretKey":
			return m.payment_channels_validation_stripe_secret();
		case "stripeWebhookSecret":
			return m.payment_channels_validation_stripe_webhook();
		case "cryptomusMerchantId":
			return m.payment_channels_validation_cryptomus_merchant();
		case "cryptomusPaymentApiKey":
			return m.payment_channels_validation_secret_length();
		case "epusdtBaseUrl":
			return m.payment_channels_validation_service_url();
		case "epusdtPid":
			return provider === "epay" || provider === "epay_v1"
				? m.payment_channels_validation_epay_pid()
				: m.payment_channels_validation_pid();
		case "epusdtSecretKey":
			return m.payment_channels_validation_secret_length();
		case "epusdtPaymentMethod":
			return m.payment_channels_validation_payment_method();
		case "alipayAppId":
		case "alipaySellerId":
			return m.payment_channels_validation_alipay_id();
		case "alipayPrivateKeyPem":
		case "wechatMerchantPrivateKeyPem":
			return m.payment_channels_validation_private_key();
		case "alipayPublicKeyPem":
		case "wechatPlatformPublicKeyPem":
			return m.payment_channels_validation_public_key();
		case "wechatAppId":
			return m.payment_channels_validation_wechat_app_id();
		case "wechatMchId":
			return m.payment_channels_validation_wechat_mch_id();
		case "wechatMerchantSerialNumber":
		case "wechatPlatformSerialNumber":
			return m.payment_channels_validation_serial_number();
		case "wechatApiV3Key":
			return m.payment_channels_validation_api_v3_key();
		default:
			return m.payment_channels_validation_invalid();
	}
}
