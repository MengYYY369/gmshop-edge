"use client";

import {
	Bar,
	BarChart,
	type BarShapeProps,
	CartesianGrid,
	Rectangle,
	XAxis,
	YAxis,
} from "recharts";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "#/components/ui/chart";
import { formatMinorAmountWithSymbol, formatNumber } from "#/lib/format";
import { m } from "#/paraglide/messages";

const chartConfig = {
	amount: {
		label: m.dashboard_sales_breakdown(),
		color: "var(--chart-1)",
	},
} satisfies ChartConfig;

const colors = [
	"var(--chart-1)",
	"var(--chart-5)",
	"var(--chart-2)",
	"var(--chart-4)",
	"var(--chart-3)",
] as const;

export function SalesBreakdownChart({
	sale,
}: {
	sale: {
		currency: string;
		currencyDecimals: number;
		amountMinor: string;
		refundMinor: string;
		netMinor: string;
		costMinor: string;
		grossProfitMinor: string;
	};
}) {
	const divisor = 10 ** sale.currencyDecimals;
	const data = [
		[m.dashboard_gross_sales(), sale.amountMinor],
		[m.dashboard_refunds(), sale.refundMinor],
		[m.dashboard_net_sales(), sale.netMinor],
		[m.dashboard_known_cost(), sale.costMinor],
		[m.dashboard_gross_profit(), sale.grossProfitMinor],
	].map(([label, amountMinor], index) => ({
		label,
		amount: Number(amountMinor) / divisor,
		amountMinor,
		color: colors[index],
	}));
	return (
		<ChartContainer className="h-60 w-full sm:h-64" config={chartConfig}>
			<BarChart data={data} layout="vertical" accessibilityLayer>
				<CartesianGrid horizontal={false} strokeDasharray="3 3" />
				<XAxis
					axisLine={false}
					dataKey="amount"
					tickFormatter={(value) => formatNumber(Number(value))}
					tickLine={false}
					type="number"
				/>
				<YAxis
					axisLine={false}
					dataKey="label"
					tickLine={false}
					type="category"
					width={76}
				/>
				<ChartTooltip
					content={
						<ChartTooltipContent
							hideLabel
							formatter={(_value, _name, item) => (
								<div className="flex min-w-40 items-center justify-between gap-4">
									<span className="text-muted-foreground">
										{String(item.payload.label)}
									</span>
									<strong>
										{formatMinorAmountWithSymbol(
											String(item.payload.amountMinor),
											sale.currency,
											sale.currencyDecimals,
										)}
									</strong>
								</div>
							)}
						/>
					}
				/>
				<Bar
					dataKey="amount"
					radius={[0, 6, 6, 0]}
					shape={(props: BarShapeProps) => (
						<Rectangle {...props} fill={String(props.payload.color)} />
					)}
				/>
			</BarChart>
		</ChartContainer>
	);
}
