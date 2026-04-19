// Import directly from file to avoid pulling in server-side dependencies via index.js
export {
	PROVIDER_MODELS,
	getProviderModels,
	getDefaultModel,
	isValidModel as isValidModelCore,
	findModelName,
	getModelTargetFormat,
	PROVIDER_ID_TO_ALIAS,
	getModelsByProviderId,
} from "@omniroute/open-sse/config/providerModels.ts";

import {
	AI_PROVIDERS,
	isAnthropicCompatibleProvider,
	isOpenAICompatibleProvider,
} from "./providers";
import { PROVIDER_MODELS as MODELS } from "@omniroute/open-sse/config/providerModels.ts";

function isPassthroughProvider(aliasOrId) {
	return Boolean(AI_PROVIDERS[aliasOrId]?.passthroughModels);
}

// Wrap isValidModel with passthrough providers
export function isValidModel(aliasOrId, modelId) {
	if (isOpenAICompatibleProvider(aliasOrId)) return true;
	if (isAnthropicCompatibleProvider(aliasOrId)) return true;
	if (isPassthroughProvider(aliasOrId)) return true;
	const models = MODELS[aliasOrId];
	if (!models) return false;
	return models.some((m) => m.id === modelId);
}

// Legacy AI_MODELS for backward compatibility
export const AI_MODELS = Object.entries(MODELS).flatMap(([alias, models]) =>
	models.map((m) => ({ provider: alias, model: m.id, name: m.name }))
);
