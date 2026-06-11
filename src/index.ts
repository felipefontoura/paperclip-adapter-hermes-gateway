// Root package entry — Paperclip's external adapter plugin loader calls
// createServerAdapter() and expects a ServerAdapterModule back.

import { execute, testEnvironment } from "./server/index";
import { buildHermesGatewayConfig } from "./ui/build-config";
import type { HermesGatewayConfig } from "./shared/types";

export const type = "hermes_gateway" as const;
export const label = "Hermes Agent (Gateway)";
export const category = "local" as const;
export const models: never[] = [];

export const agentConfigurationDoc = {
  summary:
    "Connects Paperclip to a remote Hermes Agent API server (OpenAI-compatible) over HTTP. No CLI runs inside the Paperclip container.",
  steps: [
    "Run a Hermes container with API_SERVER_ENABLED=true and API_SERVER_KEY set.",
    "Run the bundled paperclip-skills-bridge so Hermes can read Paperclip skills via .well-known/skills.",
    "Set the agent URL and API key in the Paperclip UI.",
  ],
};

// Paperclip's plugin-loader contract: top-level entry point exports a
// createServerAdapter() factory returning a ServerAdapterModule.
export function createServerAdapter() {
  return {
    type,
    label,
    category,
    execute,
    testEnvironment,
    models,
    agentConfigurationDoc,
    // The schema below tells the Paperclip UI which fields to render on the
    // New Agent dialog and the Configuration tab (url, apiKey, model,
    // timeoutSec). Without this, the UI falls back to the read-only doc and
    // operators have to PATCH adapterConfig via the API by hand.
    agentConfigurationSchema: buildHermesGatewayConfig(),
    // Tell Paperclip we accept a managed bundle (AGENTS.md / SOUL.md / etc.).
    // Paperclip then injects the resolved absolute path into adapterConfig.instructionsFilePath
    // at runtime, and our execute() reads it via readBundleEntry() and prepends as system message.
    supportsInstructionsBundle: true,
    instructionsPathKey: "instructionsFilePath",
  };
}

export { execute, testEnvironment, buildHermesGatewayConfig };
export type { HermesGatewayConfig };
