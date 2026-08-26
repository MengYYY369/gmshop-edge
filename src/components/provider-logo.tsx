import {
	SiAlipay,
	SiApple,
	SiCloudflare,
	SiDiscord,
	SiGithub,
	SiLine,
	SiMailgun,
	SiPaypal,
	SiResend,
	SiStripe,
	SiTelegram,
	SiTether,
	SiWechat,
} from "@icons-pack/react-simple-icons";
import { BadgeDollarSign, CreditCard, Mail, Stamp } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { cn } from "#/lib/utils";

type ProviderIcon = ComponentType<SVGProps<SVGSVGElement>>;
type ProviderIconDefinition = {
	brandColor?: boolean;
	color?: string;
	icon: ProviderIcon;
};

const authProviderIcons: Record<string, ProviderIconDefinition> = {
	apple: { icon: SiApple },
	credential: { icon: Mail },
	discord: { brandColor: true, icon: SiDiscord },
	github: { icon: SiGithub },
	google: { icon: GoogleLogo },
	line: { brandColor: true, icon: SiLine },
	microsoft: { icon: MicrosoftLogo },
	telegram: { brandColor: true, icon: SiTelegram },
	wechat: { brandColor: true, icon: SiWechat },
};

const paymentProviderIcons: Record<string, ProviderIconDefinition> = {
	alipay_page: { brandColor: true, icon: SiAlipay },
	alipay_wap: { brandColor: true, icon: SiAlipay },
	cryptomus: { icon: CryptomusLogo },
	epay: { color: "#1677FF", icon: BadgeDollarSign },
	epay_v1: { color: "#009CDE", icon: SiPaypal },
	gmpay: { brandColor: true, icon: SiTether },
	stripe: { brandColor: true, icon: SiStripe },
	wechat_h5: { brandColor: true, icon: SiWechat },
	wechat_native: { brandColor: true, icon: SiWechat },
};

const emailProviderIcons: Record<string, ProviderIconDefinition> = {
	cloudflare_email: { brandColor: true, icon: SiCloudflare },
	mailgun: { brandColor: true, icon: SiMailgun },
	postmark: { color: "#FFB800", icon: Stamp },
	resend: { icon: SiResend },
	sendgrid: { icon: SendGridLogo },
	smtp: { icon: Mail },
};

type ProviderLogoProps = {
	className?: string;
	logoUrl?: string | null;
	providerId: string;
};

export function AuthProviderLogo(props: ProviderLogoProps) {
	return <ProviderLogo {...props} icons={authProviderIcons} />;
}

export function PaymentProviderLogo(props: ProviderLogoProps) {
	return <ProviderLogo {...props} icons={paymentProviderIcons} />;
}

export function EmailProviderLogo(props: ProviderLogoProps) {
	return <ProviderLogo {...props} icons={emailProviderIcons} />;
}

function ProviderLogo({
	className,
	icons,
	logoUrl,
	providerId,
}: ProviderLogoProps & {
	icons: Record<string, ProviderIconDefinition>;
}) {
	if (logoUrl?.startsWith("/"))
		return (
			<img alt="" className={cn("object-contain", className)} src={logoUrl} />
		);

	const definition: ProviderIconDefinition = icons[providerId] ?? {
		icon: CreditCard,
	};
	const Icon = definition.icon;
	return (
		<Icon
			aria-hidden="true"
			className={className}
			color={
				definition.color ?? (definition.brandColor ? "default" : undefined)
			}
		/>
	);
}

function MicrosoftLogo(props: SVGProps<SVGSVGElement>) {
	return (
		<svg aria-hidden="true" viewBox="0 0 24 24" {...props}>
			<rect fill="#F25022" height="10.5" width="10.5" x="1" y="1" />
			<rect fill="#7FBA00" height="10.5" width="10.5" x="12.5" y="1" />
			<rect fill="#00A4EF" height="10.5" width="10.5" x="1" y="12.5" />
			<rect fill="#FFB900" height="10.5" width="10.5" x="12.5" y="12.5" />
		</svg>
	);
}

function CryptomusLogo(props: SVGProps<SVGSVGElement>) {
	return (
		<svg aria-hidden="true" fill="currentColor" viewBox="0 0 32 36" {...props}>
			<path d="M30.611 8.507 16.935.61a2.01 2.01 0 0 0-2.005 0L1.254 8.507A2.01 2.01 0 0 0 .25 10.245v15.791c0 .713.384 1.378 1.004 1.738L14.93 35.67a2.03 2.03 0 0 0 2.008 0l13.677-7.896a2.01 2.01 0 0 0 1.004-1.738V10.245c0-.713-.385-1.378-1.004-1.738zM16.242 17.16a.62.62 0 0 1-.62 0L2.328 9.487l13.296-7.675a.64.64 0 0 1 .62 0l13.295 7.675zm-1.312 1.197q.146.084.312.142v15.743l-13.296-7.67a.62.62 0 0 1-.311-.537V10.684z" />
		</svg>
	);
}

function GoogleLogo(props: SVGProps<SVGSVGElement>) {
	return (
		<svg aria-hidden="true" viewBox="0 0 48 48" {...props}>
			<path
				fill="#FFC107"
				d="M43.61 20.08H42V20H24v8h11.3C33.66 32.66 29.22 36 24 36c-6.63 0-12-5.37-12-12s5.37-12 12-12c3.06 0 5.84 1.15 7.96 3.04l5.66-5.66A19.9 19.9 0 0 0 24 4C12.95 4 4 12.95 4 24s8.95 20 20 20 20-8.95 20-20c0-1.34-.14-2.65-.39-3.92Z"
			/>
			<path
				fill="#FF3D00"
				d="m6.31 14.69 6.57 4.82A11.99 11.99 0 0 1 24 12c3.06 0 5.84 1.15 7.96 3.04l5.66-5.66A19.9 19.9 0 0 0 24 4 19.99 19.99 0 0 0 6.31 14.69Z"
			/>
			<path
				fill="#4CAF50"
				d="M24 44c5.02 0 9.61-1.87 13.12-4.93l-6.19-5.24A11.91 11.91 0 0 1 24 36a11.99 11.99 0 0 1-11.1-7.46l-6.52 5.02A19.99 19.99 0 0 0 24 44Z"
			/>
			<path
				fill="#1976D2"
				d="M43.61 20.08 43.6 20H24v8h11.3a12.05 12.05 0 0 1-4.38 5.83l6.19 5.24C36.68 39.46 44 34 44 24c0-1.34-.14-2.65-.39-3.92Z"
			/>
		</svg>
	);
}

function SendGridLogo(props: SVGProps<SVGSVGElement>) {
	const squares = [
		[2, 2],
		[9, 2],
		[9, 9],
		[16, 9],
		[2, 16],
		[9, 16],
		[16, 16],
	] as const;
	return (
		<svg aria-hidden="true" viewBox="0 0 24 24" {...props}>
			{squares.map(([x, y]) => (
				<rect
					fill="#1A82E2"
					height="6"
					key={`${x}-${y}`}
					rx="0.75"
					width="6"
					x={x}
					y={y}
				/>
			))}
		</svg>
	);
}
