import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { systemPermission } from "#/features/access/system-rbac";
import { applyPartialEmailChannelOrder } from "#/features/notifications/email-channel-order";
import {
	emailChannelConfigSchema,
	emailChannelEnabledSchema,
	emailChannelOrderSchema,
	notificationTemplateSchema,
} from "#/features/notifications/schema";
import { encryptNotificationConfig } from "#/features/notifications/secrets";
import {
	enqueueConfiguredEmailNotification,
	enqueueEmailNotification,
	publishPendingNotifications,
} from "#/features/notifications/server/delivery";
import { builtinNotificationTemplateRow } from "#/features/notifications/templates";
import { DomainError } from "#/lib/domain-error";
import { createAuditStatement } from "#/server/audit";
import { getAdminServerContext } from "#/server/context";
import { getCloudflareEnv } from "#/server/db.server";
import { loadRuntimeConfig } from "#/server/runtime-config";
import { reconcileNotificationTemplates } from "./reconcile-templates";

export const getNotificationCenterFn = createServerFn({
	method: "GET",
}).handler(async () => {
	const { db } = await getAdminServerContext(
		systemPermission("notifications", "read"),
	);
	await reconcileNotificationTemplates(db.$client);
	const [configs, deliveries, templates] = await Promise.all([
		db.$client
			.prepare(
				`SELECT id, name, provider, domain, region, smtp_host, smtp_port, smtp_user,
				 from_address, reply_to, sort_order, enabled,
					 last_health_status, last_checked_at, created_at, updated_at
					 FROM notification_channel_configs WHERE channel = 'email'
					 ORDER BY sort_order, id`,
			)
			.all<Record<string, unknown>>(),
		db.$client
			.prepare(
				`SELECT notification.id, notification.event, notification.channel,
				 notification.status, notification.attempt_count,
				 notification.provider_message_id, notification.next_attempt_at,
				 notification.delivered_at, notification.error_code,
				 notification.created_at, notification.updated_at,
				 (notification.status = 'delivered' AND notification.event = 'delivery_ready'
				  AND EXISTS (
				  SELECT 1 FROM delivery_records delivery
				  JOIN shop_order_items item ON item.id = delivery.order_item_id
				  WHERE delivery.id = notification.asset_id
				   AND item.allow_resend = 1
				 )) AS manual_resend_allowed
				 FROM notification_deliveries notification
				 ORDER BY notification.created_at DESC, notification.id DESC LIMIT 100`,
			)
			.all<Record<string, unknown>>(),
		db.$client
			.prepare(
				`SELECT id, event, channel, locale, subject, body, enabled, updated_at
				 FROM notification_templates ORDER BY event, channel, locale`,
			)
			.all<Record<string, unknown>>(),
	]);
	return {
		configs: configs.results.map((config) => ({
			id: String(config.id),
			name: String(config.name),
			provider: String(config.provider),
			domain: config.domain == null ? "" : String(config.domain),
			region: String(config.region),
			smtpHost: config.smtp_host == null ? "" : String(config.smtp_host),
			smtpPort: config.smtp_port == null ? 587 : Number(config.smtp_port),
			smtpUser: config.smtp_user == null ? "" : String(config.smtp_user),
			fromAddress: String(config.from_address),
			replyTo: config.reply_to == null ? "" : String(config.reply_to),
			sortOrder: Number(config.sort_order),
			enabled: Boolean(config.enabled),
			hasApiKey: config.provider !== "cloudflare_email",
			lastHealthStatus: String(config.last_health_status),
			lastCheckedAt:
				config.last_checked_at == null ? null : Number(config.last_checked_at),
		})),
		deliveries: deliveries.results.map((row) => ({
			id: String(row.id),
			event: String(row.event),
			channel: String(row.channel),
			status: String(row.status),
			attemptCount: Number(row.attempt_count),
			providerMessageId:
				row.provider_message_id == null
					? null
					: String(row.provider_message_id),
			nextAttemptAt:
				row.next_attempt_at == null ? null : Number(row.next_attempt_at),
			deliveredAt: row.delivered_at == null ? null : Number(row.delivered_at),
			errorCode: row.error_code == null ? null : String(row.error_code),
			manualResendAllowed: Boolean(row.manual_resend_allowed),
			createdAt: Number(row.created_at),
			updatedAt: Number(row.updated_at),
		})),
		templates: templates.results.map((row) => ({
			id: String(row.id),
			event: String(row.event),
			channel: String(row.channel),
			locale: String(row.locale),
			subject: row.subject == null ? "" : String(row.subject),
			body: String(row.body),
			enabled: Boolean(row.enabled),
			updatedAt: Number(row.updated_at),
		})),
	};
});

export const saveEmailChannelFn = createServerFn({ method: "POST" })
	.validator((input: z.input<typeof emailChannelConfigSchema>) =>
		emailChannelConfigSchema.parse(input),
	)
	.handler(async ({ data }) => {
		const { currentUser, db, request } = await getAdminServerContext(
			systemPermission("notifications", "update"),
		);
		const existing = await db.$client
			.prepare(
				`SELECT id, name, provider, api_key_encrypted, domain, region,
				 smtp_host, smtp_port, smtp_user,
				 from_address, reply_to, sort_order, enabled
				 FROM notification_channel_configs
				 WHERE channel = 'email' AND id = ? LIMIT 1`,
			)
			.bind(data.id ?? "")
			.first<{
				id: string;
				name: string;
				provider: string;
				api_key_encrypted: string | null;
				domain: string | null;
				region: string;
				smtp_host: string | null;
				smtp_port: number | null;
				smtp_user: string | null;
				from_address: string;
				reply_to: string | null;
				sort_order: number;
				enabled: number;
			}>();
		const conflict = await db.$client
			.prepare(
				`SELECT id FROM notification_channel_configs
				 WHERE channel = 'email' AND name = ? AND (? IS NULL OR id <> ?) LIMIT 1`,
			)
			.bind(data.name, data.id ?? null, data.id ?? null)
			.first<{ id: string }>();
		if (conflict)
			throw new DomainError(
				"notification_email_config_conflict",
				409,
				"Email configuration name already exists",
			);
		const credentialRequired = data.provider !== "cloudflare_email";
		if (
			credentialRequired &&
			(!existing || existing.provider !== data.provider) &&
			!data.apiKey
		)
			throw new DomainError(
				"notification_api_key_required",
				400,
				"API key is required",
			);
		let encrypted: string | null = null;
		if (credentialRequired && data.apiKey) {
			const runtime = await loadRuntimeConfig(db.$client);
			if (!runtime.commerceSecret)
				throw new DomainError(
					"notification_secret_unavailable",
					503,
					"Notification encryption is unavailable",
				);
			encrypted = await encryptNotificationConfig(
				data.apiKey,
				runtime.commerceSecret,
			);
		} else if (credentialRequired && existing?.provider === data.provider) {
			encrypted = existing.api_key_encrypted;
		}
		if (credentialRequired && !encrypted)
			throw new DomainError(
				"notification_api_key_required",
				400,
				"API key is required",
			);
		const id = data.id ?? crypto.randomUUID();
		const now = Date.now();
		const values = [
			data.name,
			data.provider,
			encrypted,
			encrypted ? 1 : null,
			data.provider === "mailgun" ? data.domain : null,
			data.provider === "mailgun" ? data.region : "us",
			data.provider === "smtp" ? data.smtpHost : null,
			data.provider === "smtp" ? data.smtpPort : null,
			data.provider === "smtp" ? data.smtpUser : null,
			data.fromAddress,
			data.replyTo || null,
			data.sortOrder,
			data.enabled ? 1 : 0,
		] as const;
		const mutation = existing
			? db.$client
					.prepare(
						`UPDATE notification_channel_configs SET name = ?, provider = ?,
						 api_key_encrypted = ?, api_key_version = ?, domain = ?, region = ?,
						 smtp_host = ?, smtp_port = ?, smtp_user = ?, from_address = ?,
						 reply_to = ?, sort_order = ?, enabled = ?, last_health_status = 'unknown',
						 updated_at = ? WHERE id = ? AND channel = 'email'`,
					)
					.bind(...values, now, id)
			: db.$client
					.prepare(
						`INSERT INTO notification_channel_configs
						 (id, channel, name, provider, api_key_encrypted, api_key_version,
						  domain, region, smtp_host, smtp_port, smtp_user, from_address,
						  reply_to, sort_order, enabled, last_health_status, created_at, updated_at)
						 VALUES (?, 'email', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
						  'unknown', ?, ?)`,
					)
					.bind(id, ...values, now, now);
		await db.$client.batch([
			mutation,
			createAuditStatement(db.$client, request, currentUser.id, {
				action: "notification.email_channel_saved",
				targetType: "notification_channel",
				targetId: id,
				before: existing
					? {
							name: existing.name,
							provider: existing.provider,
							domain: existing.domain,
							region: existing.region,
							smtpHost: existing.smtp_host,
							smtpPort: existing.smtp_port,
							smtpUser: existing.smtp_user,
							fromAddress: existing.from_address,
							replyTo: existing.reply_to,
							sortOrder: existing.sort_order,
							enabled: Boolean(existing.enabled),
						}
					: null,
				after: {
					name: data.name,
					provider: data.provider,
					domain: data.provider === "mailgun" ? data.domain : null,
					region: data.provider === "mailgun" ? data.region : "us",
					smtpHost: data.provider === "smtp" ? data.smtpHost : null,
					smtpPort: data.provider === "smtp" ? data.smtpPort : null,
					smtpUser: data.provider === "smtp" ? data.smtpUser : null,
					fromAddress: data.fromAddress,
					replyTo: data.replyTo,
					sortOrder: data.sortOrder,
					enabled: data.enabled,
					apiKeyChanged: Boolean(data.apiKey),
				},
			}),
		]);
		return { id };
	});

export const setEmailChannelEnabledFn = createServerFn({ method: "POST" })
	.validator((input: z.input<typeof emailChannelEnabledSchema>) =>
		emailChannelEnabledSchema.parse(input),
	)
	.handler(async ({ data }) => {
		const { currentUser, db, request } = await getAdminServerContext(
			systemPermission("notifications", "update"),
		);
		const existing = await db.$client
			.prepare(
				`SELECT id, enabled FROM notification_channel_configs
				 WHERE channel = 'email' AND id = ? LIMIT 1`,
			)
			.bind(data.id)
			.first<{ id: string; enabled: number }>();
		if (!existing)
			throw new DomainError(
				"notification_email_config_not_found",
				404,
				"Email configuration not found",
			);
		const now = Date.now();
		await db.$client.batch([
			db.$client
				.prepare(
					`UPDATE notification_channel_configs
					 SET enabled = ?, updated_at = ?
					 WHERE channel = 'email' AND id = ?`,
				)
				.bind(data.enabled ? 1 : 0, now, data.id),
			createAuditStatement(db.$client, request, currentUser.id, {
				action: "notification.email_channel_enabled_changed",
				targetType: "notification_channel",
				targetId: data.id,
				before: { enabled: Boolean(existing.enabled) },
				after: { enabled: data.enabled },
			}),
		]);
		return data;
	});

export const reorderEmailChannelsFn = createServerFn({ method: "POST" })
	.validator((input: z.input<typeof emailChannelOrderSchema>) =>
		emailChannelOrderSchema.parse(input),
	)
	.handler(async ({ data }) => {
		const { currentUser, db, request } = await getAdminServerContext(
			systemPermission("notifications", "update"),
		);
		const rows = await db.$client
			.prepare(
				`SELECT id FROM notification_channel_configs
				 WHERE channel = 'email' ORDER BY sort_order, created_at, id`,
			)
			.all<{ id: string }>();
		const orderedIds = applyPartialEmailChannelOrder(
			rows.results.map((row) => row.id),
			data.ids,
		);
		if (!orderedIds)
			throw new DomainError(
				"notification_email_channel_order_invalid",
				409,
				"Email channel order contains missing records",
			);
		const now = Date.now();
		await db.$client.batch([
			...orderedIds.map((id, index) =>
				db.$client
					.prepare(
						`UPDATE notification_channel_configs
						 SET sort_order = ?, updated_at = ?
						 WHERE id = ? AND channel = 'email'`,
					)
					.bind((index + 1) * 100, now, id),
			),
			createAuditStatement(db.$client, request, currentUser.id, {
				action: "notification.email_channel_reordered",
				targetType: "notification_channel",
				targetId: "email-channels",
				after: { ids: data.ids },
			}),
		]);
		return data;
	});

const testEmailSchema = z.object({
	configId: z.uuid().nullable().optional(),
	recipient: z.email().max(320),
});

export const sendTestEmailFn = createServerFn({ method: "POST" })
	.validator((input: z.input<typeof testEmailSchema>) =>
		testEmailSchema.parse(input),
	)
	.handler(async ({ data }) => {
		const { currentUser, db, request } = await getAdminServerContext(
			systemPermission("notifications", "update"),
		);
		const idempotencyKey = `notification-test:${currentUser.id}:${crypto.randomUUID()}`;
		let delivery: Awaited<ReturnType<typeof enqueueEmailNotification>>;
		if (data.configId) {
			const config = await db.$client
				.prepare(
					`SELECT id, from_address, reply_to FROM notification_channel_configs
					 WHERE id = ? AND channel = 'email' LIMIT 1`,
				)
				.bind(data.configId)
				.first<{
					id: string;
					from_address: string;
					reply_to: string | null;
				}>();
			if (!config)
				throw new DomainError(
					"notification_email_config_not_found",
					404,
					"Email configuration not found",
				);
			delivery = await enqueueEmailNotification(db.$client, {
				event: "notification.test",
				idempotencyKey,
				configId: config.id,
				message: {
					to: data.recipient,
					from: config.from_address,
					replyTo: config.reply_to ?? "",
					subject: "GMShop Edge email test",
					text: "Your GMShop Edge email configuration is working.",
					html: "",
				},
			});
		} else {
			delivery = await enqueueConfiguredEmailNotification(db.$client, {
				event: "notification.test",
				idempotencyKey,
				to: data.recipient,
				subject: "GMShop Edge email fallback test",
				text: "Your GMShop Edge email fallback chain is working.",
			});
		}
		const queue = getCloudflareEnv(request).COMMERCE_QUEUE;
		if (queue) await publishPendingNotifications(db.$client, queue);
		return delivery;
	});

export const saveNotificationTemplateFn = createServerFn({ method: "POST" })
	.validator((input: z.input<typeof notificationTemplateSchema>) =>
		notificationTemplateSchema.parse(input),
	)
	.handler(async ({ data }) => {
		const { currentUser, db, request } = await getAdminServerContext(
			systemPermission("notifications", "update"),
		);
		await reconcileNotificationTemplates(db.$client);
		const definition = builtinNotificationTemplateRow(data.id);
		if (!definition)
			throw new DomainError(
				"notification_template_unavailable",
				404,
				"Notification template is unavailable",
			);
		if (definition.channel === "email" && !data.subject)
			throw new DomainError(
				"notification_template_subject_required",
				400,
				"Email subject is required",
			);
		const existing = await db.$client
			.prepare(
				`SELECT id, event, channel, locale, subject, body
				 FROM notification_templates WHERE id = ? LIMIT 1`,
			)
			.bind(data.id)
			.first<Record<string, unknown>>();
		if (
			!existing ||
			existing.event !== definition.event ||
			existing.channel !== definition.channel ||
			existing.locale !== definition.locale
		)
			throw new DomainError(
				"notification_template_unavailable",
				404,
				"Notification template is unavailable",
			);
		const now = Date.now();
		await db.$client.batch([
			db.$client
				.prepare(
					`UPDATE notification_templates SET subject = ?, body = ?,
					 enabled = 1, updated_at = ? WHERE id = ?`,
				)
				.bind(
					definition.channel === "email" ? data.subject : null,
					data.body,
					now,
					data.id,
				),
			createAuditStatement(db.$client, request, currentUser.id, {
				action: "notification.template_saved",
				targetType: "notification_template",
				targetId: data.id,
				before: existing,
				after: { subject: data.subject, body: data.body },
			}),
		]);
		return { id: data.id };
	});

const retryDeliverySchema = z.object({ id: z.uuid() });

export const retryNotificationDeliveryFn = createServerFn({ method: "POST" })
	.validator((input: z.input<typeof retryDeliverySchema>) =>
		retryDeliverySchema.parse(input),
	)
	.handler(async ({ data }) => {
		const { currentUser, db, request } = await getAdminServerContext(
			systemPermission("notifications", "update"),
		);
		const now = Date.now();
		const source = await db.$client
			.prepare(
				`SELECT notification.status, notification.event,
				 COALESCE(item.allow_resend, 0) AS allow_resend
				 FROM notification_deliveries notification
				 LEFT JOIN delivery_records delivery ON delivery.id = notification.asset_id
				 LEFT JOIN shop_order_items item ON item.id = delivery.order_item_id
				 WHERE notification.id = ? LIMIT 1`,
			)
			.bind(data.id)
			.first<{
				status: string;
				event: string;
				allow_resend: number;
			}>();
		if (!source)
			throw new DomainError(
				"notification_delivery_not_retryable",
				409,
				"Notification delivery is not retryable",
			);
		const resend =
			source.status === "delivered" &&
			source.event === "delivery_ready" &&
			source.allow_resend === 1;
		if (source.status !== "failed" && !resend)
			throw new DomainError(
				"notification_delivery_not_retryable",
				409,
				"Notification delivery is not retryable",
			);
		const deliveryId = resend ? crypto.randomUUID() : data.id;
		const mutation = resend
			? db.$client
					.prepare(
						`INSERT INTO notification_deliveries
						 (id, template_id, subscription_id, channel_config_id, event, channel,
						  idempotency_key, entitlement_id, asset_type, asset_id, access_event_type,
						  message_encrypted, message_key_version, status, attempt_count,
						  next_attempt_at, created_at, updated_at)
						 SELECT ?, template_id, subscription_id, channel_config_id, event, channel,
						  ?, entitlement_id, asset_type, asset_id, access_event_type,
						  message_encrypted, message_key_version, 'pending', 0, ?, ?, ?
						 FROM notification_deliveries WHERE id = ? AND status = 'delivered'`,
					)
					.bind(
						deliveryId,
						`manual-resend:${data.id}:${deliveryId}`,
						now,
						now,
						now,
						data.id,
					)
			: db.$client
					.prepare(
						`UPDATE notification_deliveries SET status = 'pending',
						 next_attempt_at = ?, error_code = NULL, updated_at = ?
						 WHERE id = ? AND status = 'failed'`,
					)
					.bind(now, now, data.id);
		const results = await db.$client.batch([
			mutation,
			db.$client
				.prepare(
					`INSERT INTO outbox_events
					 (id, event_type, aggregate_type, aggregate_id, idempotency_key, payload,
					  status, attempt_count, created_at, updated_at)
					 SELECT ?, 'notification.requested', 'notification_delivery', id, ?, ?,
					 'pending', 0, ?, ? FROM notification_deliveries
					 WHERE id = ? AND status = 'pending'`,
				)
				.bind(
					crypto.randomUUID(),
					`notification-retry:${deliveryId}:${now}`,
					JSON.stringify({ notificationDeliveryId: deliveryId }),
					now,
					now,
					deliveryId,
				),
			createAuditStatement(db.$client, request, currentUser.id, {
				action: "notification.delivery_retried",
				targetType: "notification_delivery",
				targetId: deliveryId,
				after: { sourceDeliveryId: data.id, retriedAt: now, resend },
			}),
		]);
		if (Number(results[0]?.meta.changes ?? 0) !== 1)
			throw new DomainError(
				"notification_delivery_not_retryable",
				409,
				"Notification delivery is not retryable",
			);
		const queue = getCloudflareEnv(request).COMMERCE_QUEUE;
		if (queue) await publishPendingNotifications(db.$client, queue);
		return { id: deliveryId };
	});
