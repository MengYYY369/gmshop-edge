"use client";

import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Search, ShieldCheck } from "lucide-react";
import { type SyntheticEvent, useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { authClient } from "#/features/auth/auth-client";
import { writeGuestOrderEmail } from "#/features/storefront/order-access-storage";
import { storeOrderLookupSchema } from "#/features/storefront/schema";
import { m } from "#/paraglide/messages";

export function OrderLookupPage() {
	const navigate = useNavigate();
	const session = authClient.useSession();
	const signedIn = Boolean(session.data?.user);
	const [orderNumber, setOrderNumber] = useState("");
	const [email, setEmail] = useState("");
	const access = storeOrderLookupSchema.safeParse({ orderNumber, email });
	const canSubmit = access.success;
	function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
		event.preventDefault();
		if (!access.success) return;
		writeGuestOrderEmail(access.data.orderNumber, access.data.email);
		void navigate({
			to: "/orders/$orderNumber",
			params: { orderNumber: access.data.orderNumber },
		});
	}
	return (
		<div className="container grid min-h-[calc(100dvh-4.5rem)] gap-10 px-4 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,.72fr)] lg:items-center lg:gap-24 lg:py-16">
			<div className="max-w-2xl">
				<p className="mb-4 font-medium text-primary text-sm">
					{signedIn ? m.store_lookup_other_guest_order() : m.store_nav_orders()}
				</p>
				<h1 className="max-w-xl text-balance font-semibold text-4xl tracking-[-0.04em] sm:text-6xl">
					{m.store_lookup_title()}
				</h1>
				<p className="mt-5 max-w-xl text-pretty text-muted-foreground leading-7">
					{m.store_lookup_description()}
				</p>
				{signedIn ? (
					<div className="mt-8 max-w-xl rounded-2xl bg-primary/8 p-5">
						<p className="font-semibold">{m.store_lookup_signed_in_title()}</p>
						<p className="mt-1 text-muted-foreground text-sm leading-6">
							{m.store_lookup_signed_in_description()}
						</p>
						<Button asChild className="mt-4">
							<Link to="/account/orders">
								{m.store_lookup_signed_in_action()}
								<ArrowRight />
							</Link>
						</Button>
					</div>
				) : null}
			</div>
			<form
				className="grid gap-5 rounded-3xl bg-muted/35 p-6 sm:p-8"
				onSubmit={submit}
			>
				<div className="grid gap-2">
					<Label htmlFor="order-number">{m.store_order_number()}</Label>
					<Input
						autoComplete="off"
						id="order-number"
						maxLength={80}
						minLength={8}
						placeholder="GM-…"
						required
						value={orderNumber}
						onChange={(event) => setOrderNumber(event.target.value)}
					/>
				</div>
				<div className="grid gap-2">
					<Label htmlFor="order-email">{m.store_contact_email()}</Label>
					<Input
						autoComplete="email"
						id="order-email"
						maxLength={320}
						placeholder="name@example.com"
						required
						type="email"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
					/>
				</div>
				<Button className="mt-1 h-12" disabled={!canSubmit} type="submit">
					<Search />
					{m.store_find_order()}
				</Button>
				<div className="flex items-start gap-2 text-muted-foreground text-xs leading-5">
					<ShieldCheck className="mt-0.5 size-4 shrink-0" />
					<span>{m.store_lookup_security_notice()}</span>
				</div>
			</form>
		</div>
	);
}
