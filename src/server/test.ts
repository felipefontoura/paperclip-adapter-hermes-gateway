// testEnvironment: verify URL + bearer reach the Hermes API server.
// Hits GET /v1/models — the simplest smoke test.

import { USER_AGENT } from "../shared/constants";
import { resolveConfig, validateOutboundUrl, sanitizeErrorText } from "./util";

interface TestContext {
  agent?: { adapterConfig?: any };
}

interface TestResult {
  status: "pass" | "warn" | "fail";
  message: string;
  details?: Record<string, unknown>;
}

export async function testEnvironment(ctx: TestContext): Promise<TestResult> {
  const cfg = resolveConfig(ctx.agent?.adapterConfig);

  if (!cfg.apiKey) {
    return { status: "warn", message: "apiKey not set — bearer token required to talk to the Hermes API server." };
  }

  let validatedUrl: URL;
  try { validatedUrl = validateOutboundUrl(cfg.url); }
  catch (e: any) {
    return { status: "fail", message: `Refused to call upstream: ${e?.message ?? "unsafe URL"}` };
  }

  const url = validatedUrl.toString().replace(/\/+$/, "") + "/models";
  const headers = {
    Authorization: `Bearer ${cfg.apiKey}`,
    "User-Agent": USER_AGENT,
  };

  try {
    const resp = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return { status: "fail", message: `HTTP ${resp.status}: ${sanitizeErrorText(body)}` };
    }
    const data: any = await resp.json();
    const count = Array.isArray(data?.data) ? data.data.length : 0;
    return {
      status: "pass",
      message: `Hermes API server reachable, ${count} model(s) advertised.`,
      details: { models: data?.data?.map((m: any) => m?.id) },
    };
  } catch (err: any) {
    if (err?.name === "AbortError" || err?.name === "TimeoutError") {
      return { status: "fail", message: "Hermes API server did not respond within 5s" };
    }
    return { status: "fail", message: `Cannot reach Hermes API: ${sanitizeErrorText(err?.message ?? err)}` };
  }
}
