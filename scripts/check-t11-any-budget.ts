#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();

const ANY_BUDGET = [
  { file: "src/app/api/settings/proxy/route.ts", maxAny: 0 },
  { file: "src/app/api/settings/proxy/test/route.ts", maxAny: 0 },
  { file: "src/shared/components/OAuthModal.tsx", maxAny: 0 },
  { file: "open-sse/translator/index.ts", maxAny: 0 },
  { file: "open-sse/translator/registry.ts", maxAny: 0 },
  // Freeze legacy hot spots to avoid any-regression while strict migration continues.
  { file: "src/lib/db/apiKeys.ts", maxAny: 0 },
  { file: "src/lib/db/encryption.ts", maxAny: 0 },
  { file: "src/lib/db/prompts.ts", maxAny: 0 },
  { file: "src/lib/db/providers.ts", maxAny: 0 },
  { file: "src/lib/db/settings.ts", maxAny: 0 },
  { file: "open-sse/config/providerRegistry.ts", maxAny: 0 },
  { file: "open-sse/config/providerModels.ts", maxAny: 0 },
  { file: "open-sse/services/signatureCache.ts", maxAny: 0 },
  { file: "open-sse/services/comboMetrics.ts", maxAny: 0 },
  { file: "open-sse/services/sessionManager.ts", maxAny: 0 },
  { file: "open-sse/services/provider.ts", maxAny: 0 },
  { file: "open-sse/services/contextManager.ts", maxAny: 0 },
  { file: "open-sse/services/comboConfig.ts", maxAny: 0 },
  { file: "open-sse/services/accountSelector.ts", maxAny: 0 },
  { file: "open-sse/services/wildcardRouter.ts", maxAny: 0 },
  { file: "open-sse/services/rateLimitSemaphore.ts", maxAny: 0 },
  { file: "open-sse/services/roleNormalizer.ts", maxAny: 0 },
  { file: "open-sse/services/usage.ts", maxAny: 0 },
  { file: "open-sse/services/rateLimitManager.ts", maxAny: 0 },
  { file: "open-sse/services/tokenRefresh.ts", maxAny: 0 },
  { file: "open-sse/services/backgroundTaskDetector.ts", maxAny: 0 },
  { file: "open-sse/services/accountFallback.ts", maxAny: 0 },
  { file: "open-sse/handlers/responseSanitizer.ts", maxAny: 0 },
  { file: "open-sse/handlers/responseTranslator.ts", maxAny: 0 },
  { file: "open-sse/utils/stream.ts", maxAny: 0 },
  { file: "open-sse/translator/request/openai-responses.ts", maxAny: 0 },
  { file: "open-sse/executors/base.ts", maxAny: 0 },
  { file: "open-sse/executors/kiro.ts", maxAny: 0 },
  { file: "open-sse/executors/cursor.ts", maxAny: 0 },
  { file: "open-sse/executors/qoder.ts", maxAny: 0 },
  { file: "open-sse/utils/comfyuiClient.ts", maxAny: 0 },
  { file: "open-sse/utils/tlsClient.ts", maxAny: 0 },
  { file: "open-sse/utils/proxyFetch.ts", maxAny: 0 },
  { file: "open-sse/utils/error.ts", maxAny: 0 },
  { file: "open-sse/translator/request/openai-to-gemini.ts", maxAny: 0 },
  { file: "open-sse/translator/request/antigravity-to-openai.ts", maxAny: 0 },
  { file: "open-sse/translator/request/claude-to-openai.ts", maxAny: 0 },
  { file: "open-sse/handlers/audioTranscription.ts", maxAny: 0 },
  { file: "open-sse/handlers/sseParser.ts", maxAny: 0 },
  { file: "open-sse/handlers/chatCore.ts", maxAny: 0 },
  { file: "open-sse/config/codexInstructions.ts", maxAny: 0 },
  { file: "open-sse/config/imageRegistry.ts", maxAny: 0 },
  { file: "open-sse/config/registryUtils.ts", maxAny: 0 },
  { file: "open-sse/executors/antigravity.ts", maxAny: 0 },
  { file: "open-sse/executors/default.ts", maxAny: 0 },
  { file: "open-sse/handlers/audioSpeech.ts", maxAny: 0 },
  { file: "open-sse/handlers/embeddings.ts", maxAny: 0 },
  { file: "open-sse/handlers/imageGeneration.ts", maxAny: 0 },
  { file: "open-sse/handlers/moderations.ts", maxAny: 0 },
  { file: "open-sse/handlers/rerank.ts", maxAny: 0 },
  { file: "open-sse/handlers/responsesHandler.ts", maxAny: 0 },
  { file: "open-sse/services/combo.ts", maxAny: 0 },
  { file: "open-sse/services/thinkingBudget.ts", maxAny: 0 },
  { file: "open-sse/translator/helpers/geminiHelper.ts", maxAny: 0 },
  { file: "open-sse/translator/helpers/openaiHelper.ts", maxAny: 0 },
  { file: "open-sse/translator/helpers/responsesApiHelper.ts", maxAny: 0 },
  { file: "open-sse/translator/request/claude-to-gemini.ts", maxAny: 0 },
  { file: "open-sse/translator/request/gemini-to-openai.ts", maxAny: 0 },
  { file: "open-sse/translator/request/openai-to-claude.ts", maxAny: 1 }, // 1 = string literal "any" (Claude tool_choice value, not a TS type) — #1072
  { file: "open-sse/translator/request/openai-to-cursor.ts", maxAny: 0 },
  { file: "open-sse/translator/request/openai-to-kiro.ts", maxAny: 0 },
  { file: "open-sse/translator/response/claude-to-openai.ts", maxAny: 0 },
  { file: "open-sse/translator/response/gemini-to-openai.ts", maxAny: 0 },
  { file: "open-sse/translator/response/kiro-to-openai.ts", maxAny: 0 },
  { file: "open-sse/translator/response/openai-responses.ts", maxAny: 0 },
  { file: "open-sse/translator/response/openai-to-antigravity.ts", maxAny: 0 },
  { file: "open-sse/utils/bypassHandler.ts", maxAny: 0 },
  { file: "open-sse/utils/logger.ts", maxAny: 0 },
  { file: "open-sse/utils/networkProxy.ts", maxAny: 0 },
  { file: "open-sse/utils/ollamaTransform.ts", maxAny: 0 },
  { file: "open-sse/utils/proxyDispatcher.ts", maxAny: 0 },
  { file: "open-sse/utils/requestLogger.ts", maxAny: 0 },
  { file: "open-sse/utils/streamHandler.ts", maxAny: 0 },
  { file: "open-sse/utils/usageTracking.ts", maxAny: 0 },
];

const anyRegex = /\bany\b/g;

function countExplicitAny(source) {
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const withoutLineComments = withoutBlockComments.replace(/\/\/.*$/gm, "");
  return withoutLineComments.match(anyRegex)?.length ?? 0;
}

function checkBudgetEntry({ file, maxAny }) {
  const absolutePath = path.resolve(cwd, file);
  if (!fs.existsSync(absolutePath)) {
    console.error(`[t11:any-budget] FAIL - file not found: ${file}`);
    return false;
  }

  const content = fs.readFileSync(absolutePath, "utf8");
  const explicitAnyCount = countExplicitAny(content);
  const passed = explicitAnyCount <= maxAny;

  console.log(
    `[t11:any-budget] ${passed ? "OK" : "FAIL"} - ${file} (explicit any: ${explicitAnyCount}, budget: ${maxAny})`
  );

  return passed;
}

const hasFailure = ANY_BUDGET.some((item) => !checkBudgetEntry(item));

if (hasFailure) {
  process.exit(1);
}

console.log("[t11:any-budget] PASS - explicit any budget respected.");
