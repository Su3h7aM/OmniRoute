"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { useTranslations } from "next-intl";
import Modal from "./Modal";
import Button from "./Button";
import Input from "./Input";

export default function CursorAuthModal({ isOpen, onSuccess, onClose }) {
	const t = useTranslations("cursorAuthModal");
	const [accessToken, setAccessToken] = useState("");
	const [machineId, setMachineId] = useState("");
	const [error, setError] = useState(null);
	const [importing, setImporting] = useState(false);

	const handleImportToken = async () => {
		if (!accessToken.trim()) {
			setError(t("errorEnterToken"));
			return;
		}

		setImporting(true);
		setError(null);

		try {
			const body: Record<string, string> = { accessToken: accessToken.trim() };
			if (machineId.trim()) body.machineId = machineId.trim();

			const res = await fetch("/api/oauth/cursor/import", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});

			const data = await res.json();

			if (!res.ok) {
				throw new Error(data.error || t("errorImportFailed"));
			}

			onSuccess?.();
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setImporting(false);
		}
	};

	return (
		<Modal isOpen={isOpen} title={t("title")} onClose={onClose}>
			<div className="flex flex-col gap-4">
				<div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
					<div className="flex gap-2">
						<span className="material-symbols-outlined text-blue-600 dark:text-blue-400">
							info
						</span>
						<p className="text-sm text-blue-800 dark:text-blue-200">
							Paste your Cursor access token to connect this account.
						</p>
					</div>
				</div>

				<div>
					<label htmlFor="cursor-access-token" className="block text-sm font-medium mb-2">
						{t("accessToken")} <span className="text-red-500">{t("required")}</span>
					</label>
					<textarea
						id="cursor-access-token"
						value={accessToken}
						onChange={(e) => setAccessToken(e.target.value)}
						placeholder={t("accessTokenPlaceholder")}
						rows={3}
						className="w-full px-3 py-2 text-sm font-mono border border-border rounded-lg bg-background focus:outline-none focus:border-primary resize-none"
					/>
				</div>

				<div>
					<label htmlFor="cursor-machine-id" className="block text-sm font-medium mb-2">
						{t("machineId")}{" "}
						<span className="text-text-muted text-xs">{t("optional")}</span>
					</label>
					<Input
						id="cursor-machine-id"
						value={machineId}
						onChange={(e) => setMachineId(e.target.value)}
						placeholder={t("machineIdPlaceholder")}
						className="font-mono text-sm"
					/>
				</div>

				{error && (
					<div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
						<p className="text-sm text-red-600 dark:text-red-400">{error}</p>
					</div>
				)}

				<div className="flex gap-2">
					<Button
						onClick={handleImportToken}
						fullWidth
						disabled={importing || !accessToken.trim()}
					>
						{importing ? t("importing") : t("importToken")}
					</Button>
					<Button onClick={onClose} variant="ghost" fullWidth>
						{t("cancel")}
					</Button>
				</div>
			</div>
		</Modal>
	);
}

CursorAuthModal.propTypes = {
	isOpen: PropTypes.bool.isRequired,
	onSuccess: PropTypes.func,
	onClose: PropTypes.func.isRequired,
};
