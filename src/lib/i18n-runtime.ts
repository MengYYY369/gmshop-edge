import {
	defineCustomClientStrategy,
	defineCustomServerStrategy,
} from "#/paraglide/runtime";
import { type SupportedLocale, supportedLocales } from "./locales";

const systemDefaultLocales = new WeakMap<Request, SupportedLocale>();
const systemDefaultLocaleHeader = "x-gmshop-system-default-locale";

defineCustomServerStrategy("custom-system-default", {
	getLocale: (request) =>
		localeFromCookie(request?.headers.get("cookie")) ??
		(request
			? (supportedLocale(request.headers.get(systemDefaultLocaleHeader)) ??
				systemDefaultLocales.get(request))
			: undefined),
});

defineCustomClientStrategy("custom-system-default", {
	getLocale: () =>
		supportedLocale(
			typeof document === "undefined"
				? undefined
				: document.documentElement.lang,
		),
	setLocale: () => undefined,
});

export function localeFromCookie(cookieHeader?: string | null) {
	const value = cookieHeader
		?.split(";")
		.map((part) => part.trim())
		.find((part) => part.startsWith("PARAGLIDE_LOCALE="))
		?.slice("PARAGLIDE_LOCALE=".length);
	return supportedLocale(value);
}

export function setSystemDefaultLocale(
	request: Request,
	locale: SupportedLocale,
) {
	const headers = new Headers(request.headers);
	headers.set(systemDefaultLocaleHeader, locale);
	let localizedRequest: Request;
	if (Object.getPrototypeOf(request) === Request.prototype) {
		localizedRequest = new Request(request, { headers });
	} else {
		// Nitro may provide a Request from a different JavaScript realm. Undici
		// cannot clone that object directly, so rebuild it from public fields.
		const init: RequestInit & { duplex?: "half" } = {
			method: request.method,
			headers,
			redirect: request.redirect,
			signal: request.signal,
		};
		if (request.method !== "GET" && request.method !== "HEAD") {
			init.body = request.body;
			init.duplex = "half";
		}
		localizedRequest = new Request(request.url, init);
	}
	systemDefaultLocales.set(localizedRequest, locale);
	return localizedRequest;
}

function supportedLocale(value?: string | null): SupportedLocale | undefined {
	return supportedLocales.find((locale) => locale === value);
}
