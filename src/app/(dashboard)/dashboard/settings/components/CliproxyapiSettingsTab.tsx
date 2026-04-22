"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Input, Toggle } from "@/shared/components";

interface Settings {
	cliproxyapi_fallback_enabled?: boolean;
	cliproxyapi_url?: string;
	cliproxyapi_fallback_codes?: string;
	[key: string]: unknown;
}

type MessageState = {
	type: "success" | "error";
	text: string;
};

function isValidUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

function getMessageClassName(type: MessageState["type"]): string {
	if (type === "success") {
		return "bg-green-500/10 text-green-600 dark:text-green-400";
	}

	return "bg-red-500/10 text-red-600 dark:text-red-400";
}

export default function CliproxyapiSettingsTab() {
	const [settings, setSettings] = useState<Settings>({});
	const [loading, setLoading] = useState(true);
	const [message, setMessage] = useState<MessageState | null>(null);

	useEffect(() => {
		fetch("/api/settings")
			.then((r) => {
				if (!r.ok) throw new Error(`Settings API returned ${r.status}`);
				return r.json();
			})
			.then((data) => {
				setSettings(data);
				setLoading(false);
			})
			.catch((err) => {
				console.error("Failed to load settings:", err);
				setLoading(false);
			});
	}, []);

	const updateSetting = useCallback(async (key: string, value: boolean | string) => {
		if (key === "cliproxyapi_url" && typeof value === "string" && value.trim() !== "") {
			if (!isValidUrl(value)) {
				setMessage({ type: "error", text: "Invalid URL format. Use http:// or https://" });
				return;
			}
		}

		setMessage(null);
		try {
			const res = await fetch("/api/settings", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ [key]: value }),
			});
			if (!res.ok) {
				throw new Error(`Server returned ${res.status}`);
			}
			await res.json();
			setSettings((prev) => ({ ...prev, [key]: value }));
			setMessage({ type: "success", text: "Setting saved" });
		} catch {
			setMessage({ type: "error", text: "Failed to save setting" });
		}
	}, []);

	const cpaEnabled = settings.cliproxyapi_fallback_enabled === true;
	const cpaUrl = settings.cliproxyapi_url || "http://127.0.0.1:8317";
	const cpaCodes = settings.cliproxyapi_fallback_codes || "502,401,403,429,503";

	return (
		<div className="space-y-4">
			{message && (
				<div
					className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${getMessageClassName(message.type)}`}
				>
					<span className="material-symbols-outlined text-[14px]">
						{message.type === "success" ? "check_circle" : "error"}
					</span>
					{message.text}
				</div>
			)}

			<Card padding="md">
				<div className="flex items-center gap-3 mb-4">
					<div className="size-8 rounded-lg flex items-center justify-center bg-indigo-500/10">
						<span className="material-symbols-outlined text-indigo-500 text-xl">
							swap_horiz
						</span>
					</div>
					<div>
						<h3 className="font-medium text-sm">CLIProxyAPI Fallback</h3>
						<p className="text-xs text-text-muted">
							When enabled, failed requests are retried through CLIProxyAPI
							(localhost:8317)
						</p>
					</div>
				</div>

				{loading ? (
					<div className="flex items-center gap-2 text-text-muted text-sm">
						<span className="material-symbols-outlined animate-spin text-base">
							progress_activity
						</span>
						Loading...
					</div>
				) : (
					<div className="space-y-4">
						<div className="flex items-center justify-between">
							<span className="text-sm text-text-main">
								Enable CLIProxyAPI Fallback
							</span>
							<Toggle
								checked={cpaEnabled}
								onChange={(checked) =>
									updateSetting("cliproxyapi_fallback_enabled", checked)
								}
							/>
						</div>

						{cpaEnabled && (
							<>
								<div>
									<label
										htmlFor="cliproxyapi-url"
										className="text-xs text-text-muted mb-1.5 block"
									>
										CLIProxyAPI URL
									</label>
									<Input
										id="cliproxyapi-url"
										value={cpaUrl}
										onChange={(e) =>
											updateSetting("cliproxyapi_url", e.target.value)
										}
										placeholder="http://127.0.0.1:8317"
										className="w-full"
									/>
								</div>

								<div>
									<label
										htmlFor="cliproxyapi-fallback-codes"
										className="text-xs text-text-muted mb-1.5 block"
									>
										Fallback Status Codes (comma-separated)
									</label>
									<Input
										id="cliproxyapi-fallback-codes"
										value={cpaCodes}
										onChange={(e) =>
											updateSetting(
												"cliproxyapi_fallback_codes",
												e.target.value
											)
										}
										placeholder="502,401,403,429,503"
										className="w-full"
									/>
								</div>
							</>
						)}
					</div>
				)}
			</Card>
		</div>
	);
}
