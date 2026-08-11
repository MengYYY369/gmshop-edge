export function safeStorePaymentUrl(value: string | null) {
	if (!value) return null;
	try {
		const localBase = new URL("https://gmshop.invalid");
		const url = new URL(value, localBase);
		if (value.startsWith("/"))
			return url.origin === localBase.origin
				? `${url.pathname}${url.search}${url.hash}`
				: null;
		// WeChat native pay QR deeplink
		if (
			url.protocol === "weixin:" &&
			url.hostname === "wxpay" &&
			url.pathname === "/bizpayurl" &&
			!url.username &&
			!url.password
		)
			return url.toString();
		// Alipay app deeplink (for QR code rendering)
		if (
			url.protocol === "alipays:" &&
			!url.username &&
			!url.password &&
			url.host
		)
			return url.toString();
		return url.protocol === "https:" && !url.username && !url.password
			? url.toString()
			: null;
	} catch {
		return null;
	}
}
