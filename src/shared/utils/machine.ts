import { getConsistentMachineId } from "./machineId";

export async function getMachineId() {
	return await getConsistentMachineId();
}

// Keep sync functions for backward compatibility but make them no-ops
// (Frontend sync is disabled - use backend sync instead)
function logFrontendSyncDisabled() {
	console.log("Frontend sync is disabled. Use backend sync instead.");
}

export async function syncProviderDataToCloud(_cloudUrl) {
	logFrontendSyncDisabled();
	return true;
}

export async function getProvidersNeedingRefresh() {
	logFrontendSyncDisabled();
	return [];
}
