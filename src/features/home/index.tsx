"use client";

import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Boxes, Search } from "lucide-react";
import { type SyntheticEvent, useEffect, useState } from "react";
import type { z } from "zod";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Skeleton } from "#/components/ui/skeleton";
import { useSiteBrand } from "#/context/site-brand-provider";
import { trackCommerceEvent } from "#/features/storefront/commerce-events";
import {
	StorefrontProductCard,
	StorefrontProductCardSkeleton,
} from "#/features/storefront/components/product-card";
import type { storefrontListSchema } from "#/features/storefront/schema";
import { listStorefrontCatalogFn } from "#/features/storefront/server/catalog";
import { m } from "#/paraglide/messages";

export function HomePage({
	searchParams,
}: {
	searchParams: z.infer<typeof storefrontListSchema>;
}) {
	const brand = useSiteBrand();
	const navigate = useNavigate({ from: "/" });
	const [draftSearch, setDraftSearch] = useState(searchParams.search);
	const catalog = useQuery({
		queryKey: ["storefront", "catalog", searchParams],
		queryFn: () => listStorefrontCatalogFn({ data: searchParams }),
		staleTime: 30_000,
	});
	useEffect(() => {
		trackCommerceEvent({ eventType: "catalog_viewed" });
	}, []);
	function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
		event.preventDefault();
		void navigate({
			search: { ...searchParams, search: draftSearch.trim() },
		});
	}
	function clearFilters() {
		setDraftSearch("");
		void navigate({
			search: {
				search: "",
				tag: "",
				sort: searchParams.sort,
			},
		});
	}
	const hasFilters = Boolean(searchParams.search || searchParams.tag);
	return (
		<div className="min-h-[70vh]">
			<section className="container px-4 pt-10 pb-8 sm:pt-14 sm:pb-10">
				<div className="grid items-end gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,.85fr)]">
					<div>
						<p className="mb-4 font-medium text-primary text-sm">
							{brand.name}
						</p>
						<h1 className="max-w-4xl text-balance font-semibold text-4xl leading-[1.05] tracking-[-0.04em] sm:text-5xl lg:text-6xl">
							{m.store_hero_title()}
						</h1>
					</div>
					<div className="lg:pb-1">
						<p className="max-w-xl text-pretty text-muted-foreground leading-7 sm:text-lg">
							{m.store_hero_subtitle()}
						</p>
						<form className="relative mt-6" onSubmit={submit}>
							<Search className="pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								aria-label={m.store_search_placeholder()}
								className="h-12 rounded-xl bg-muted/45 ps-10 pe-24 text-base shadow-none"
								value={draftSearch}
								onChange={(event) => setDraftSearch(event.target.value)}
								placeholder={m.store_search_placeholder()}
							/>
							<Button
								className="absolute end-1 top-1 h-10 rounded-lg px-4"
								type="submit"
							>
								{m.common_search()}
							</Button>
						</form>
					</div>
				</div>
				<div className="mt-9 flex items-center gap-4">
					<div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
						<Button
							className="shrink-0 rounded-full"
							size="sm"
							variant={searchParams.tag ? "ghost" : "default"}
							onClick={() =>
								void navigate({ search: { ...searchParams, tag: "" } })
							}
						>
							{m.store_all_tags()}
						</Button>
						{catalog.data?.tags.map((item) => (
							<Button
								className="shrink-0 rounded-full"
								key={item.name}
								size="sm"
								variant={searchParams.tag === item.name ? "default" : "ghost"}
								onClick={() =>
									void navigate({
										search: { ...searchParams, tag: item.name },
									})
								}
							>
								{item.name}
							</Button>
						))}
					</div>
					<Select
						onValueChange={(sort) =>
							void navigate({
								search: {
									...searchParams,
									sort: sort as typeof searchParams.sort,
								},
							})
						}
						value={searchParams.sort}
					>
						<SelectTrigger
							aria-label={m.store_sort_label()}
							className="shrink-0 border-0 bg-transparent shadow-none"
							size="sm"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent align="end">
							<SelectItem value="featured">
								{m.store_sort_featured()}
							</SelectItem>
							<SelectItem value="newest">{m.store_sort_newest()}</SelectItem>
							<SelectItem value="price_asc">
								{m.store_sort_price_asc()}
							</SelectItem>
							<SelectItem value="price_desc">
								{m.store_sort_price_desc()}
							</SelectItem>
							<SelectItem value="popular">{m.store_sort_popular()}</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</section>
			<section className="container px-4 pb-16">
				<div className="mb-6 flex min-h-[3.25rem] items-center justify-between gap-4">
					<div>
						<h2 className="font-semibold text-xl">
							{hasFilters
								? m.store_catalog_results()
								: m.store_catalog_featured()}
						</h2>
						{catalog.data ? (
							<p className="mt-1 text-muted-foreground text-sm">
								{m.store_catalog_count({
									count: catalog.data.products.length,
								})}
							</p>
						) : catalog.isLoading ? (
							<Skeleton
								className="mt-1 h-4 w-20"
								data-skeleton-region="catalog-count"
							/>
						) : null}
					</div>
					{hasFilters ? (
						<Button
							className="rounded-full"
							onClick={clearFilters}
							size="sm"
							variant="ghost"
						>
							{m.store_clear_filters()}
						</Button>
					) : null}
				</div>
				{catalog.isLoading ? (
					<ProductGridSkeleton />
				) : catalog.data?.products.length ? (
					<div className="grid gap-x-5 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
						{catalog.data.products.map((product) => (
							<StorefrontProductCard key={product.id} product={product} />
						))}
					</div>
				) : (
					<div className="grid min-h-72 place-items-center rounded-3xl bg-muted/30 text-center">
						<div>
							<Boxes className="mx-auto size-10 text-muted-foreground" />
							<h2 className="mt-4 font-semibold text-xl">
								{hasFilters
									? m.store_empty_title()
									: m.store_no_products_title()}
							</h2>
							<p className="mt-2 text-muted-foreground text-sm">
								{hasFilters
									? m.store_empty_description()
									: m.store_no_products_description()}
							</p>
							{hasFilters ? (
								<Button
									className="mt-5 rounded-full"
									onClick={clearFilters}
									size="sm"
								>
									{m.store_clear_filters()}
								</Button>
							) : null}
						</div>
					</div>
				)}
			</section>
		</div>
	);
}

export function ProductGridSkeleton() {
	return (
		<output
			aria-busy="true"
			aria-label={m.common_loading()}
			className="grid gap-x-5 gap-y-10 sm:grid-cols-2 lg:grid-cols-3"
			data-skeleton-layout="product-grid"
		>
			{["a", "b", "c", "d", "e", "f"].map((key) => (
				<StorefrontProductCardSkeleton key={key} />
			))}
		</output>
	);
}
