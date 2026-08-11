"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
	ChevronDown,
	MoreHorizontal,
	Pencil,
	PlugZap,
	Plus,
	Trash2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
	type ConfigurationLogoDraft,
	ConfigurationLogoField,
} from "#/components/configuration-logo-field";
import { ProButton } from "#/components/pro/base/button";
import { ModalForm } from "#/components/pro/form";
import { ProTable, type ProTableState } from "#/components/pro/table";
import { PaymentProviderLogo } from "#/components/provider-logo";
import { Badge } from "#/components/ui/badge";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { Switch } from "#/components/ui/switch";
import { getStoreCurrencyConfigurationFn } from "#/features/exchange-rates/server/public";
import { paymentChannelErrorMessage } from "#/features/shop-payments/error-message";
import { paymentChannelFormErrors } from "#/features/shop-payments/form-validation";
import {
	type PaymentProvider,
	type PaymentProviderFamily,
	paymentProviderDefaultCurrency,
	paymentProviderFamily,
	type paymentProviderValues,
} from "#/features/shop-payments/provider";
import {
	deletePaymentChannelFn,
	listPaymentChannelsFn,
	removePaymentChannelLogoFn,
	reorderPaymentChannelsFn,
	savePaymentChannelFn,
	setPaymentChannelEnabledFn,
	testPaymentChannelFn,
	uploadPaymentChannelLogoFn,
} from "#/features/shop-payments/server/admin";
import { ConfirmDialog } from "#/layouts/components/confirm-dialog";
import { PageHeader } from "#/layouts/components/page-header";
import {
	formatBasisPoints,
	formatDateTime,
	formatMinorAmount,
	formatNumber,
} from "#/lib/format";
import { useCurrentProTableUrlState } from "#/lib/pro-table-url-state";
import { m } from "#/paraglide/messages";

type ChannelPageResult = Awaited<ReturnType<typeof listPaymentChannelsFn>>;
type Channel = ChannelPageResult["data"][number];

export function PaymentConfigurationsPage() {
	const tableUrlState = useCurrentProTableUrlState({ searchColumnId: "name" });
	const client = useQueryClient();
	const currencies = useQuery({
		queryKey: ["storefront", "currency-configuration"],
		queryFn: () => getStoreCurrencyConfigurationFn(),
		staleTime: 60_000,
	});
	const [refreshKey, setRefreshKey] = useState(0);
	const [creatingProvider, setCreatingProvider] = useState<
		(typeof paymentProviderValues)[number] | null
	>(null);
	const [editing, setEditing] = useState<Channel | null>(null);
	const [creatingLogo, setCreatingLogo] =
		useState<ConfigurationLogoDraft | null>(null);
	const [deleting, setDeleting] = useState<Channel | null>(null);
	const refresh = useCallback(async () => {
		await client.invalidateQueries({
			queryKey: ["admin", "payment-configurations"],
		});
		setRefreshKey((value) => value + 1);
	}, [client]);
	const request = useCallback(
		(state: ProTableState) => {
			const search = String(
				state.columnFilters.find((filter) => filter.id === "name")?.value ?? "",
			);
			const input = {
				pageIndex: state.pagination.pageIndex,
				pageSize: state.pagination.pageSize,
				search,
			};
			return client.fetchQuery({
				queryKey: ["admin", "payment-configurations", input],
				queryFn: () => listPaymentChannelsFn({ data: input }),
			});
		},
		[client],
	);
	const save = useMutation({
		mutationFn: savePaymentChannelFn,
	});
	const toggle = useMutation({
		mutationFn: setPaymentChannelEnabledFn,
		onSuccess: refresh,
		onError: showError,
	});
	const reorder = useMutation({
		mutationFn: reorderPaymentChannelsFn,
		onSuccess: refresh,
		onError: showError,
	});
	const test = useMutation({
		mutationFn: testPaymentChannelFn,
		onSuccess: async () => {
			await refresh();
		},
		onError: showError,
	});
	const remove = useMutation({
		mutationFn: deletePaymentChannelFn,
		onSuccess: async () => {
			setDeleting(null);
			await refresh();
		},
		onError: showError,
	});
	const columns = useMemo<ColumnDef<Channel>[]>(
		() => [
			{
				accessorKey: "enabled",
				header: m.common_enabled(),
				cell: ({ row }) => (
					<Switch
						aria-label={`${m.common_enabled()} · ${row.original.name}`}
						checked={row.original.enabled}
						disabled={toggle.isPending}
						onCheckedChange={(enabled) =>
							toggle.mutate({ data: { id: row.original.id, enabled } })
						}
					/>
				),
			},
			{
				accessorKey: "name",
				header: m.common_name(),
				meta: { search: true },
				cell: ({ row }) => (
					<div className="flex items-center gap-3">
						<PaymentProviderLogo
							className="size-9 rounded-lg"
							logoUrl={row.original.logoUrl}
							providerId={row.original.provider}
						/>
						<div>
							<strong className="block">{row.original.name}</strong>
							<span className="text-muted-foreground text-xs">
								{paymentProviderLabel(row.original.provider)} ·{" "}
								{row.original.currency}
							</span>
						</div>
					</div>
				),
			},
			{
				id: "fee",
				header: m.payment_channels_fee_bps(),
				cell: ({ row }) =>
					`${formatBasisPoints(row.original.feeBps)} + ${formatMinorAmount(row.original.fixedFeeMinor, row.original.currency, 2)}`,
			},
			{
				accessorKey: "healthStatus",
				header: m.payment_channels_health(),
				cell: ({ row }) => (
					<Badge
						variant={
							row.original.healthStatus === "healthy" ? "default" : "outline"
						}
					>
						{healthLabel(row.original.healthStatus)}
					</Badge>
				),
			},
			{
				accessorKey: "attemptCount",
				header: m.payment_channels_attempts(),
				cell: ({ row }) => formatNumber(row.original.attemptCount),
			},
			{
				accessorKey: "lastCheckedAt",
				header: m.payment_channels_test(),
				cell: ({ row }) =>
					row.original.lastCheckedAt
						? formatDateTime(row.original.lastCheckedAt)
						: "—",
			},
			{
				id: "actions",
				header: m.common_actions(),
				cell: ({ row }) => (
					<div className="flex justify-end">
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<ProButton
									size="icon-sm"
									variant="ghost"
									tooltip={m.common_actions()}
								>
									<MoreHorizontal />
								</ProButton>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem onClick={() => setEditing(row.original)}>
									<Pencil />
									{m.common_edit()}
								</DropdownMenuItem>
								<DropdownMenuItem
									disabled={test.isPending}
									onClick={() => test.mutate({ data: { id: row.original.id } })}
								>
									<PlugZap />
									{m.payment_channels_test()}
								</DropdownMenuItem>
								<DropdownMenuItem
									variant="destructive"
									onClick={() => setDeleting(row.original)}
								>
									<Trash2 />
									{m.common_delete()}
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				),
			},
		],
		[test, toggle],
	);

	async function submit(values: Record<string, unknown>, channel?: Channel) {
		return save.mutateAsync({
			data: paymentChannelInputFromForm(values, channel),
		});
	}

	return (
		<>
			<div className="flex min-h-0 w-full flex-1 flex-col gap-4">
				<PageHeader
					title={m.nav_payment_channels()}
					description={m.payment_channels_description()}
					actions={
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<ProButton>
									<Plus />
									{m.common_new()}
									<ChevronDown />
								</ProButton>
							</DropdownMenuTrigger>
							<DropdownMenuContent
								align="end"
								className="max-h-80 overflow-y-auto"
							>
								{paymentProviderMenu.map((item) => (
									<DropdownMenuItem
										key={item.family}
										onClick={() => setCreatingProvider(item.provider)}
									>
										<PaymentProviderLogo
											className="size-4"
											providerId={item.provider}
										/>
										{item.label}
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
					}
				/>
				<ProTable
					initialState={tableUrlState.initialState}
					onChange={tableUrlState.onChange}
					className="min-h-0 flex-1"
					columns={columns}
					dragSort={{
						rowKey: "id",
						onDragSortEnd: (rows) =>
							reorder.mutate({ data: { ids: rows.map((row) => row.id) } }),
					}}
					request={request}
					requestKey={refreshKey}
					onRefresh={refresh}
					toolbarSearch={{ columnId: "name", placeholder: m.common_search() }}
					table={{ stickyHeader: true }}
				/>
			</div>
			{creatingProvider ? (
				<ModalForm
					key={creatingProvider}
					open
					onOpenChange={(open) => {
						if (open) return;
						setCreatingProvider(null);
						setCreatingLogo(null);
					}}
					title={m.payment_channels_new()}
					schema={channelFormSchema(false)}
					initialValues={newChannelValues(
						creatingProvider,
						currencies.data?.baseCurrency ?? "USD",
					)}
					validate={(values) =>
						paymentChannelFormErrors(paymentChannelInputFromForm(values))
					}
					onFinish={async (values) => {
						const channel = await submit(values);
						if (creatingLogo)
							await uploadPaymentChannelLogoFn({
								data: { id: channel.id, ...creatingLogo },
							});
						await refresh();
						setCreatingProvider(null);
						setCreatingLogo(null);
					}}
					onFinishFailed={showError}
					modalClassName="sm:max-w-2xl"
					fieldsClassName="grid gap-4 space-y-0 sm:grid-cols-2"
				>
					<ConfigurationLogoField
						onPendingChange={setCreatingLogo}
						url={null}
					/>
				</ModalForm>
			) : null}
			{editing ? (
				<ModalForm
					key={editing.id}
					open
					onOpenChange={(open) => !open && setEditing(null)}
					title={m.payment_channels_edit()}
					schema={channelFormSchema(true)}
					initialValues={channelValues(editing)}
					validate={(values) =>
						paymentChannelFormErrors(
							paymentChannelInputFromForm(values, editing),
						)
					}
					onFinish={async (values) => {
						await submit(values, editing);
						await refresh();
					}}
					onFinishFailed={showError}
					modalClassName="sm:max-w-2xl"
					fieldsClassName="grid gap-4 space-y-0 sm:grid-cols-2"
				>
					<ConfigurationLogoField
						id={editing.id}
						onChanged={refresh}
						remove={removePaymentChannelLogoFn}
						upload={uploadPaymentChannelLogoFn}
						url={editing.logoUrl}
					/>
				</ModalForm>
			) : null}
			<ConfirmDialog
				open={Boolean(deleting)}
				onOpenChange={(open) => !open && setDeleting(null)}
				title={m.payment_channels_delete_title()}
				desc={m.payment_channels_delete_description({
					name: deleting?.name ?? "",
				})}
				confirmText={m.common_delete()}
				destructive
				isLoading={remove.isPending}
				handleConfirm={() =>
					deleting && remove.mutate({ data: { id: deleting.id } })
				}
			/>
		</>
	);
}

function newChannelValues(
	provider: (typeof paymentProviderValues)[number],
	baseCurrency: string,
) {
	return {
		type: paymentProviderFamily(provider),
		name: paymentProviderLabel(provider),
		currency: paymentProviderDefaultCurrency(provider, baseCurrency),
		feeBps: 0,
		fixedFeeMinor: "0",
		enabled: false,
		stripeSecretKey: "",
		stripeWebhookSecret: "",
		cryptomusMerchantId: "",
		cryptomusPaymentApiKey: "",
		epusdtBaseUrl: "",
		epusdtPid: "",
		epusdtSecretKey: "",
		epusdtPaymentMethod: provider === "epay" || provider === "epay_v1" ? "alipay" : "",
		alipayAppId: "",
		alipaySellerId: "",
		alipayPrivateKeyPem: "",
		alipayPublicKeyPem: "",
		wechatAppId: "",
		wechatMchId: "",
		wechatMerchantSerialNumber: "",
		wechatMerchantPrivateKeyPem: "",
		wechatApiV3Key: "",
		wechatPlatformSerialNumber: "",
		wechatPlatformPublicKeyPem: "",
		defaultToken: "",
		defaultNetwork: "",
		paypalClientId: "",
		paypalClientSecret: "",
		paypalWebhookId: "",
		paypalIsSandbox: "live",
	};
}

function channelFormSchema(editing: boolean) {
	const common = [
		{
			name: "type",
			label: m.payment_channels_provider(),
			valueType: "select" as const,
			required: true,
			fieldProps: {
				disabled: editing,
				options: paymentTypeOptions,
			},
		},
		{ name: "name", label: m.common_name(), required: true },
		{
			name: "currency",
			label: m.payment_channels_fee_currency(),
			required: true,
			tooltip: m.payment_channels_fee_currency_tooltip(),
		},
		{
			name: "feeBps",
			label: m.payment_channels_fee_bps(),
			required: true,
			fieldProps: { inputMode: "numeric" },
		},
		{
			name: "fixedFeeMinor",
			label: m.payment_channels_fixed_fee(),
			required: true,
			fieldProps: { inputMode: "numeric" },
		},
	];
	const extra = editing ? m.payment_channels_credential_hint() : undefined;
	return [
		...common,
		{
			name: "stripeSecretKey",
			label: m.payment_channels_stripe_secret_key(),
			valueType: "password" as const,
			required: !editing,
			extra,
			hidden: (values: Record<string, unknown>) => values.type !== "stripe",
		},
		{
			name: "stripeWebhookSecret",
			label: m.payment_channels_stripe_webhook_secret(),
			valueType: "password" as const,
			required: !editing,
			extra,
			hidden: (values: Record<string, unknown>) => values.type !== "stripe",
		},
		{
			name: "cryptomusMerchantId",
			label: m.payment_channels_cryptomus_merchant_id(),
			required: !editing,
			extra,
			hidden: (values: Record<string, unknown>) => values.type !== "cryptomus",
		},
		{
			name: "cryptomusPaymentApiKey",
			label: m.payment_channels_cryptomus_payment_api_key(),
			valueType: "password" as const,
			required: !editing,
			extra,
			hidden: (values: Record<string, unknown>) => values.type !== "cryptomus",
		},
		{
			name: "alipayAppId",
			label: m.payment_channels_alipay_app_id(),
			required: !editing,
			extra,
			hidden: (values: Record<string, unknown>) => values.type !== "alipay",
		},
		{
			name: "alipaySellerId",
			label: m.payment_channels_alipay_seller_id(),
			required: !editing,
			extra,
			hidden: (values: Record<string, unknown>) => values.type !== "alipay",
		},
		{
			name: "alipayPrivateKeyPem",
			label: m.payment_channels_merchant_private_key(),
			valueType: "textarea" as const,
			required: !editing,
			extra,
			formItemProps: { className: "sm:col-span-2" },
			hidden: (values: Record<string, unknown>) => values.type !== "alipay",
		},
		{
			name: "alipayPublicKeyPem",
			label: m.payment_channels_alipay_public_key(),
			valueType: "textarea" as const,
			required: !editing,
			extra,
			formItemProps: { className: "sm:col-span-2" },
			hidden: (values: Record<string, unknown>) => values.type !== "alipay",
		},
		{
			name: "wechatAppId",
			label: m.payment_channels_wechat_app_id(),
			required: !editing,
			extra,
			hidden: (values: Record<string, unknown>) => values.type !== "wechat",
		},
		{
			name: "wechatMchId",
			label: m.payment_channels_wechat_mch_id(),
			required: !editing,
			extra,
			hidden: (values: Record<string, unknown>) => values.type !== "wechat",
		},
		{
			name: "wechatMerchantSerialNumber",
			label: m.payment_channels_merchant_serial(),
			required: !editing,
			extra,
			hidden: (values: Record<string, unknown>) => values.type !== "wechat",
		},
		{
			name: "wechatMerchantPrivateKeyPem",
			label: m.payment_channels_merchant_private_key(),
			valueType: "textarea" as const,
			required: !editing,
			extra,
			formItemProps: { className: "sm:col-span-2" },
			hidden: (values: Record<string, unknown>) => values.type !== "wechat",
		},
		{
			name: "wechatApiV3Key",
			label: m.payment_channels_wechat_api_v3_key(),
			valueType: "password" as const,
			required: !editing,
			extra,
			hidden: (values: Record<string, unknown>) => values.type !== "wechat",
		},
		{
			name: "wechatPlatformSerialNumber",
			label: m.payment_channels_platform_serial(),
			required: !editing,
			extra,
			hidden: (values: Record<string, unknown>) => values.type !== "wechat",
		},
		{
			name: "wechatPlatformPublicKeyPem",
			label: m.payment_channels_wechat_platform_public_key(),
			valueType: "textarea" as const,
			required: !editing,
			extra,
			formItemProps: { className: "sm:col-span-2" },
			hidden: (values: Record<string, unknown>) => values.type !== "wechat",
		},
		{
			name: "epusdtBaseUrl",
			label: m.payment_channels_epusdt_base_url(),
			required: !editing,
			extra,
			formItemProps: { className: "sm:col-span-2" },
			hidden: (values: Record<string, unknown>) =>
				values.type !== "gmpay" &&
				values.type !== "epay" &&
				values.type !== "epay_v1",
		},
		{
			name: "epusdtPid",
			label: m.payment_channels_epusdt_pid(),
			required: !editing,
			extra,
			hidden: (values: Record<string, unknown>) =>
				values.type !== "gmpay" &&
				values.type !== "epay" &&
				values.type !== "epay_v1",
		},
		{
			name: "epusdtSecretKey",
			label: m.payment_channels_epusdt_secret_key(),
			valueType: "password" as const,
			required: !editing,
			extra,
			hidden: (values: Record<string, unknown>) =>
				values.type !== "gmpay" &&
				values.type !== "epay" &&
				values.type !== "epay_v1",
		},
		{
			name: "epusdtPaymentMethod",
			label: m.payment_channels_epusdt_payment_method(),
			tooltip: m.payment_channels_epusdt_payment_method_hint(),
			required: true,
			hidden: (values: Record<string, unknown>) =>
				values.type !== "epay" && values.type !== "epay_v1",
		},
		{
			name: "defaultToken",
			label: m.payment_channels_epusdt_token(),
			tooltip: m.payment_channels_epusdt_asset_hint(),
			hidden: (values: Record<string, unknown>) =>
				values.type !== "gmpay" &&
				values.type !== "epay" &&
				values.type !== "cryptomus",
		},
		{
			name: "defaultNetwork",
			label: m.payment_channels_epusdt_network(),
			tooltip: m.payment_channels_epusdt_asset_hint(),
			hidden: (values: Record<string, unknown>) =>
				values.type !== "gmpay" &&
				values.type !== "epay" &&
				values.type !== "cryptomus",
		},
		{
			name: "paypalClientId",
			label: "PayPal Client ID",
			required: true,
			extra,
			hidden: (values: Record<string, unknown>) =>
				values.type !== "paypal",
		},
		{
			name: "paypalClientSecret",
			label: "PayPal Client Secret",
			valueType: "password" as const,
			required: true,
			extra,
			hidden: (values: Record<string, unknown>) =>
				values.type !== "paypal",
		},
		{
			name: "paypalWebhookId",
			label: "PayPal Webhook ID",
			tooltip: editing
				? "Add Webhook ID from PayPal Developer Dashboard. Webhook URL is shown below."
				: "Optional during creation. Add later after registering webhook in PayPal.",
			required: false,
			extra,
			hidden: (values: Record<string, unknown>) =>
				values.type !== "paypal",
		},
		{
			name: "paypalIsSandbox",
			label: "Environment",
			valueType: "select" as const,
			required: true,
			fieldProps: {
				options: [
					{ value: "sandbox", label: "Sandbox" },
					{ value: "live", label: "Live" },
				],
			},
			hidden: (values: Record<string, unknown>) =>
				values.type !== "paypal",
		},
	];
}

function channelValues(channel: Channel) {
	return {
		type: paymentProviderFamily(channel.provider),
		name: channel.name,
		currency: channel.currency,
		feeBps: channel.feeBps,
		fixedFeeMinor: channel.fixedFeeMinor,
		enabled: channel.enabled,
		stripeSecretKey: "",
		stripeWebhookSecret: "",
		cryptomusMerchantId: "",
		cryptomusPaymentApiKey: "",
		epusdtBaseUrl: "",
		epusdtPid: "",
		epusdtSecretKey: "",
		epusdtPaymentMethod: channel.paymentMethod,
		alipayAppId: "",
		alipaySellerId: "",
		alipayPrivateKeyPem: "",
		alipayPublicKeyPem: "",
		wechatAppId: "",
		wechatMchId: "",
		wechatMerchantSerialNumber: "",
		wechatMerchantPrivateKeyPem: "",
		wechatApiV3Key: "",
		wechatPlatformSerialNumber: "",
		wechatPlatformPublicKeyPem: "",
		defaultToken: channel.defaultToken,
		defaultNetwork: channel.defaultNetwork,
		paypalClientId: "",
		paypalClientSecret: "",
		paypalWebhookId: "",
		paypalIsSandbox: "",
	};
}

function paymentProviderLabel(
	provider: (typeof paymentProviderValues)[number],
) {
	if (provider === "gmpay") return "GMpay";
	if (provider === "cryptomus") return "Cryptomus";
	if (provider === "epay") return "EPay";
	if (provider === "epay_v1") return "EPay V1";
	if (provider === "paypal") return "PayPal";
	if (provider === "alipay_page" || provider === "alipay_wap") return "Alipay";
	if (provider === "wechat_native" || provider === "wechat_h5")
		return "WeChat Pay";
	return "Stripe";
}

const paymentProviderMenu = [
	{ family: "gmpay", provider: "gmpay", label: "GMpay" },
	{ family: "alipay", provider: "alipay_page", label: "Alipay" },
	{ family: "wechat", provider: "wechat_native", label: "WeChat Pay" },
	{ family: "stripe", provider: "stripe", label: "Stripe" },
	{ family: "cryptomus", provider: "cryptomus", label: "Cryptomus" },
	{ family: "epay", provider: "epay", label: "EPay" },
	{ family: "epay_v1", provider: "epay_v1", label: "EPay V1" },
	{ family: "paypal", provider: "paypal", label: "PayPal" },
] as const;

const paymentTypeOptions = paymentProviderMenu.map((item) => ({
	value: item.family,
	label: item.label,
}));

function paymentProviderFromForm(
	values: Record<string, unknown>,
): PaymentProvider {
	const type = String(values.type ?? "stripe") as PaymentProviderFamily;
	if (type === "alipay") return "alipay_page";
	if (type === "wechat") return "wechat_native";
	return type;
}

function paymentChannelInputFromForm(
	values: Record<string, unknown>,
	channel?: Channel,
) {
	const provider = paymentProviderFromForm(values);
	return {
		id: channel?.id,
		provider,
		name: String(values.name ?? ""),
		currency: String(values.currency ?? ""),
		feeBps: numericFormValue(values.feeBps),
		fixedFeeMinor: String(values.fixedFeeMinor ?? ""),
		sortOrder: channel?.sortOrder ?? 100,
		enabled: channel?.enabled ?? false,
		stripeSecretKey: String(values.stripeSecretKey ?? ""),
		stripeWebhookSecret: String(values.stripeWebhookSecret ?? ""),
		cryptomusMerchantId: String(values.cryptomusMerchantId ?? ""),
		cryptomusPaymentApiKey: String(values.cryptomusPaymentApiKey ?? ""),
		epusdtBaseUrl: String(values.epusdtBaseUrl ?? ""),
		epusdtPid: String(values.epusdtPid ?? ""),
		epusdtSecretKey: String(values.epusdtSecretKey ?? ""),
		epusdtPaymentMethod:
			provider === "epay" || provider === "epay_v1"
				? String(values.epusdtPaymentMethod ?? "alipay")
				: "",
		alipayAppId: String(values.alipayAppId ?? ""),
		alipaySellerId: String(values.alipaySellerId ?? ""),
		alipayPrivateKeyPem: String(values.alipayPrivateKeyPem ?? ""),
		alipayPublicKeyPem: String(values.alipayPublicKeyPem ?? ""),
		wechatAppId: String(values.wechatAppId ?? ""),
		wechatMchId: String(values.wechatMchId ?? ""),
		wechatMerchantSerialNumber: String(values.wechatMerchantSerialNumber ?? ""),
		wechatMerchantPrivateKeyPem: String(
			values.wechatMerchantPrivateKeyPem ?? "",
		),
		wechatApiV3Key: String(values.wechatApiV3Key ?? ""),
		wechatPlatformSerialNumber: String(values.wechatPlatformSerialNumber ?? ""),
		wechatPlatformPublicKeyPem: String(values.wechatPlatformPublicKeyPem ?? ""),
		paypalClientId: String(values.paypalClientId ?? ""),
		paypalClientSecret: String(values.paypalClientSecret ?? ""),
		paypalWebhookId: String(values.paypalWebhookId ?? ""),
		paypalIsSandbox: String(values.paypalIsSandbox ?? "live"),
		defaultToken: String(values.defaultToken ?? ""),
		defaultNetwork: String(values.defaultNetwork ?? ""),
	};
}

function numericFormValue(value: unknown) {
	return String(value ?? "").trim() ? Number(value) : Number.NaN;
}

function healthLabel(status: Channel["healthStatus"]) {
	if (status === "healthy") return m.infrastructure_healthy();
	if (status === "unhealthy") return m.infrastructure_unhealthy();
	return m.infrastructure_health_unknown();
}

function showError(error: unknown) {
	toast.error(paymentChannelErrorMessage(error));
}
