// User-facing config schema for the New Agent dialog.
// Paperclip's UI rendering uses this metadata to draw the form fields.

import { DEFAULT_URL, DEFAULT_TIMEOUT_SEC } from "../shared/constants";

export function buildHermesGatewayConfig() {
  return {
    fields: [
      {
        key: "url",
        label: "Hermes API URL",
        type: "text",
        defaultValue: DEFAULT_URL,
        placeholder: "http://hermes-gateway:8642/v1",
        description: "OpenAI-compatible endpoint exposed by the Hermes API server.",
        required: true,
      },
      {
        key: "apiKey",
        label: "API Key (bearer)",
        type: "secret",
        placeholder: "Must match the API_SERVER_KEY on the Hermes container",
        description: "Bearer token authenticating to the Hermes API server.",
        required: true,
      },
      {
        key: "model",
        label: "Model (optional)",
        type: "text",
        defaultValue: "",
        placeholder: "leave empty to use the Hermes server default",
        description:
          "Model id to request. When empty, Hermes uses the model configured in its own config.yaml.",
      },
      {
        key: "timeoutSec",
        label: "Timeout (seconds)",
        type: "number",
        defaultValue: DEFAULT_TIMEOUT_SEC,
        description: "Abort the request if Hermes hasn't responded within this many seconds.",
      },
    ],
  };
}
