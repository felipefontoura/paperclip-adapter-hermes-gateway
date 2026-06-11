// Shared TypeScript types for the Hermes Gateway adapter.

export interface HermesGatewayConfig {
  /** Hermes API server endpoint, e.g. http://hermes-gateway:8642/v1 */
  url?: string;
  /** Bearer token matching the Hermes API_SERVER_KEY */
  apiKey?: string;
  /** Optional model name; falls back to the Hermes server default */
  model?: string;
  /** Request timeout in seconds; default 300 */
  timeoutSec?: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}
