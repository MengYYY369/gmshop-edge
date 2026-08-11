"use client";

import { Link, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Upload, UploadTrigger } from "#/components/pro/base/fields/upload";
import { FormItem } from "#/components/pro/form";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import {
	configurationLogoContentTypes,
	configurationLogoMaxBytes,
} from "#/lib/configuration-logo";
import { m } from "#/paraglide/messages";
import { cn } from "#/lib/utils";

type LogoResult = { url: string };
type LogoInput = {
	data: {
		id: string;
		contentType: (typeof configurationLogoContentTypes)[number];
		base64: string;
	};
};

export type ConfigurationLogoDraft = {
	contentType: (typeof configurationLogoContentTypes)[number];
	base64: string;
};

type ConfigurationLogoFieldProps = {
	id?: string;
	url: string | null;
	upload?: (input: LogoInput) => Promise<LogoResult>;
	remove?: (input: { data: { id: string } }) => Promise<unknown>;
	onChanged?: () => Promise<unknown>;
	onPendingChange?: (draft: ConfigurationLogoDraft | null) => void;
	allowDirectUrl?: boolean;
	directUrl?: string;
	onDirectUrlChange?: (url: string) => void;
};

export function ConfigurationLogoField({
	id,
	url,
	upload,
	remove,
	onChanged,
	onPendingChange,
	allowDirectUrl = true,
	directUrl: externalDirectUrl,
	onDirectUrlChange,
}: ConfigurationLogoFieldProps) {
	const [preview, setPreview] = useState(url ?? "");
	const [busy, setBusy] = useState(false);
	const [internalDirectUrl, setInternalDirectUrl] = useState("");
	const directUrlValue = externalDirectUrl ?? internalDirectUrl;
	const setDirectUrl = onDirectUrlChange ?? setInternalDirectUrl;

	useEffect(() => {
		setPreview(url ?? "");
	}, [url]);

	async function uploadFile(file?: File) {
		if (!file) return false;
		if (
			!configurationLogoContentTypes.includes(
				file.type as (typeof configurationLogoContentTypes)[number],
			) ||
			file.size > configurationLogoMaxBytes
		) {
			toast.error(m.settings_site_logo_invalid());
			return false;
		}
		setBusy(true);
		try {
			const dataUrl = await fileDataUrl(file);
			const validation = await validateSquareImage(dataUrl);
			if (!validation) {
				toast.error(m.settings_site_logo_square());
				return false;
			}
			const draft = {
				contentType:
					file.type as (typeof configurationLogoContentTypes)[number],
				base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
			};
			if (!id) {
				onPendingChange?.(draft);
				setPreview(dataUrl);
				return dataUrl;
			}
			if (!upload) return false;
			const result = await upload({ data: { id, ...draft } });
			setPreview(result.url);
			await onChanged?.();
			return result.url;
		} catch {
			toast.error(m.settings_save_failed());
			return false;
		} finally {
			setBusy(false);
		}
	}

	function handleDirectUrlApply() {
		const trimmed = directUrlValue.trim();
		if (!trimmed) return;
		try {
			new URL(trimmed);
		} catch {
			toast.error("Invalid URL");
			return;
		}
		setPreview(trimmed);
		setDirectUrl("");
	}

	return (
		<FormItem
			label={m.settings_site_logo_title()}
			description={
				allowDirectUrl
					? "Upload an image or paste a CDN URL"
					: m.configuration_logo_description()
			}
		>
			<div className="flex flex-col gap-3">
				<div className="relative size-32 overflow-hidden rounded-xl bg-muted">
					<Upload
						accept={configurationLogoContentTypes.join(",")}
						className="size-full"
						disabled={busy}
						maxCount={1}
						multiple={false}
						upload={async (files) => uploadFile(files[0])}
						value={[]}
					>
						{preview ? (
							<img
								alt={m.settings_site_logo_title()}
								className="size-full object-contain p-2"
								src={preview}
							/>
						) : null}
						<UploadTrigger
							className={cn(
								"absolute inset-0 size-full p-3",
								preview &&
									"border-2 bg-background/10 text-transparent opacity-0 hover:bg-background/55 hover:text-foreground hover:opacity-100 focus-visible:bg-background/55 focus-visible:text-foreground focus-visible:opacity-100",
							)}
						/>
					</Upload>
					{preview ? (
						<Button
							aria-label={m.common_delete()}
							className="absolute top-2 end-2 z-20"
							disabled={busy}
							onClick={async () => {
								setBusy(true);
								try {
									if (id && remove) await remove({ data: { id } });
									else onPendingChange?.(null);
									setPreview("");
									await onChanged?.();
								} catch {
									toast.error(m.settings_save_failed());
								} finally {
									setBusy(false);
								}
							}}
							size="icon-sm"
							type="button"
							variant="secondary"
						>
							<Trash2 />
						</Button>
					) : null}
				</div>
				{allowDirectUrl ? (
					<div className="flex gap-2">
						<div className="relative flex-1">
							<Link className="text-muted-foreground absolute start-3 top-1/2 size-4 -translate-y-1/2" />
							<Input
								className="ps-9"
								disabled={busy}
								placeholder="https://cdn.example.com/logo.png"
								type="url"
								value={directUrlValue}
								onChange={(e) => setDirectUrl(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										handleDirectUrlApply();
									}
								}}
							/>
						</div>
						<Button
							disabled={busy || !directUrlValue.trim()}
							onClick={handleDirectUrlApply}
							size="sm"
							type="button"
						>
							Apply
						</Button>
					</div>
				) : null}
			</div>
		</FormItem>
	);
}

function fileDataUrl(file: File) {
	return new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}

function validateSquareImage(dataUrl: string) {
	return new Promise<boolean>((resolve) => {
		const image = new Image();
		image.onload = () =>
			resolve(
				image.naturalWidth === image.naturalHeight && image.naturalWidth > 0,
			);
		image.onerror = () => resolve(false);
		image.src = dataUrl;
	});
}
