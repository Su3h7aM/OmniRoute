"use client";

import { useState, useEffect, useCallback } from "react";
import { SegmentedControl } from "@/shared/components";
import EndpointPageClient from "./EndpointPageClient";
import A2ADashboardPage from "./components/A2ADashboard";
import ApiEndpointsTab from "./ApiEndpointsTab";
import { useTranslations } from "next-intl";

type ServiceStatus = {
	online: boolean;
	loading: boolean;
};

function getStatusStyles(status: ServiceStatus) {
	if (status.loading) {
		return {
			borderColor: "var(--color-border)",
			background: "transparent",
			color: "var(--color-text-muted)",
			dotBackground: "var(--color-text-muted)",
			animation: "none",
			label: "...",
		};
	}

	if (status.online) {
		return {
			borderColor: "rgba(34,197,94,0.3)",
			background: "rgba(34,197,94,0.1)",
			color: "rgb(34,197,94)",
			dotBackground: "rgb(34,197,94)",
			animation: "pulse 2s infinite",
			label: "Online",
		};
	}

	return {
		borderColor: "rgba(239,68,68,0.3)",
		background: "rgba(239,68,68,0.1)",
		color: "rgb(239,68,68)",
		dotBackground: "rgb(239,68,68)",
		animation: "none",
		label: "Offline",
	};
}

/* ────── Toggle Switch ────── */
function ServiceToggle({
	label,
	status,
	enabled,
	onToggle,
	toggling,
}: {
	label: string;
	status: ServiceStatus;
	enabled: boolean;
	onToggle: () => void;
	toggling: boolean;
}) {
	const statusStyles = getStatusStyles(status);

	return (
		<div className="flex items-center gap-3 ml-auto">
			<div
				className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border"
				style={{
					borderColor: statusStyles.borderColor,
					background: statusStyles.background,
					color: statusStyles.color,
				}}
			>
				<span
					className="inline-block w-2 h-2 rounded-full"
					style={{
						background: statusStyles.dotBackground,
						animation: statusStyles.animation,
					}}
				/>
				{statusStyles.label}
			</div>

			<button
				type="button"
				onClick={onToggle}
				disabled={toggling}
				className="relative inline-flex items-center h-7 w-[52px] rounded-full transition-all duration-300 focus:outline-none border"
				style={{
					background: enabled ? "rgb(34,197,94)" : "var(--color-bg-tertiary)",
					borderColor: enabled ? "rgba(34,197,94,0.5)" : "var(--color-border)",
					opacity: toggling ? 0.6 : 1,
					cursor: toggling ? "wait" : "pointer",
				}}
				title={enabled ? `Disable ${label}` : `Enable ${label}`}
			>
				<span
					className="inline-block w-5 h-5 rounded-full shadow-md transition-all duration-300"
					style={{
						transform: enabled ? "translateX(26px)" : "translateX(3px)",
						background: enabled ? "#fff" : "var(--color-text-muted)",
					}}
				/>
			</button>

			<span
				className="text-xs font-medium min-w-[24px]"
				style={{ color: enabled ? "rgb(34,197,94)" : "var(--color-text-muted)" }}
			>
				{toggling ? "..." : enabled ? "ON" : "OFF"}
			</span>
		</div>
	);
}

/* ────── Main Page ────── */
export default function EndpointPage() {
	const [activeTab, setActiveTab] = useState("endpoint-proxy");
	const t = useTranslations("endpoints");

	const [a2aStatus, setA2aStatus] = useState<ServiceStatus>({ online: false, loading: true });
	const [a2aEnabled, setA2aEnabled] = useState(false);
	const [a2aToggling, setA2aToggling] = useState(false);

	const patchSetting = useCallback(async (body: Record<string, unknown>) => {
		return fetch("/api/settings", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	}, []);

	useEffect(() => {
		const loadSettings = async () => {
			try {
				const response = await fetch("/api/settings");
				if (!response.ok) {
					return;
				}
				const data = await response.json();
				setA2aEnabled(Boolean(data.a2aEnabled));
			} catch {
				// defaults stay
			}
		};

		void loadSettings();
	}, []);

	const toggleA2a = useCallback(async () => {
		const newValue = !a2aEnabled;
		setA2aToggling(true);
		try {
			const res = await patchSetting({ a2aEnabled: newValue });
			if (res.ok) setA2aEnabled(newValue);
		} catch {
			// keep current state
		} finally {
			setA2aToggling(false);
		}
	}, [a2aEnabled, patchSetting]);

	const refreshA2aStatus = useCallback(async () => {
		setA2aStatus((prev) => ({ ...prev, loading: true }));
		try {
			const res = await fetch("/api/a2a/status");
			if (res.ok) {
				const data = await res.json();
				setA2aStatus({ online: data.status === "ok", loading: false });
			} else {
				setA2aStatus({ online: false, loading: false });
			}
		} catch {
			setA2aStatus({ online: false, loading: false });
		}
	}, []);

	useEffect(() => {
		void refreshA2aStatus();
		const interval = setInterval(() => void refreshA2aStatus(), 30000);
		return () => clearInterval(interval);
	}, [refreshA2aStatus]);

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-wrap items-center gap-3">
				<SegmentedControl
					options={[
						{ value: "endpoint-proxy", label: t("tabProxy"), icon: "api" },
						{ value: "a2a", label: "A2A", icon: "group_work" },
						{ value: "api-endpoints", label: t("tabApiEndpoints"), icon: "code" },
					]}
					value={activeTab}
					onChange={setActiveTab}
				/>

				{activeTab === "a2a" && (
					<ServiceToggle
						label="A2A"
						status={a2aStatus}
						enabled={a2aEnabled}
						onToggle={() => void toggleA2a()}
						toggling={a2aToggling}
					/>
				)}
			</div>

			{activeTab === "endpoint-proxy" && <EndpointPageClient machineId="" />}
			{activeTab === "a2a" && <A2ADashboardPage />}
			{activeTab === "api-endpoints" && <ApiEndpointsTab />}
		</div>
	);
}
