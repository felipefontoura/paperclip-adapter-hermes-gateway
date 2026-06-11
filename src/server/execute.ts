// Execute: POST a chat completion to the remote Hermes API server.
// Mirrors the openclaw-gateway pattern (two functions: execute + testEnvironment).

import { USER_AGENT } from "../shared/constants";
import { resolveConfig, readBundleEntry, cfgString, pickConfigValue, validateOutboundUrl, sanitizeErrorText } from "./util";
import type { ChatMessage } from "../shared/types";

interface ExecutionContext {
  agent?: {
    id?: string;
    companyId?: string;
    name?: string;
    adapterConfig?: any;
  };
  authToken?: string;
  runId?: string;
  /** Prompt text Paperclip wants to send (heartbeat/task body). */
  prompt?: string;
  /** Fallback when prompt is empty (some Paperclip versions use this name). */
  task?: string;
}

interface ExecutionContextFull extends ExecutionContext {
  onLog?: (stream: "stdout" | "stderr", chunk: string) => void | Promise<void>;
}

// Mirror of Paperclip's `AdapterExecutionResult` contract — every field that
// downstream runs / UI lifecycle expects must be present, including the
// "no signal, no timeout" markers. Without `signal: null` + `timedOut: false`
// some Paperclip versions keep the agent in a `running` UI state even after
// the run row reports `succeeded`.
interface ExecutionResult {
  exitCode: number;
  signal: string | null;
  timedOut: boolean;
  provider?: string;
  model?: string;
  summary?: string;
  errorMessage?: string;
  errorCode?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
  };
  costUsd?: number;
  resultJson?: Record<string, unknown>;
}

export async function execute(ctx: ExecutionContextFull): Promise<ExecutionResult> {
  const cfg = resolveConfig(ctx.agent?.adapterConfig);
  const log = ctx.onLog ?? (() => {});

  if (!cfg.apiKey) {
    await log("stderr", "Hermes Gateway adapter: apiKey is required (set via Configuration tab; must match the API_SERVER_KEY env on the Hermes server).\n");
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      provider: "hermes_gateway",
      errorMessage: "Hermes Gateway adapter: apiKey is required.",
      errorCode: "missing_api_key",
    };
  }

  // SSRF guard — reject internal/cloud-metadata URLs before the bearer leaves the host.
  let validatedHermesUrl: URL;
  try { validatedHermesUrl = validateOutboundUrl(cfg.url); }
  catch (e: any) {
    const msg = `Hermes Gateway adapter: refused to call upstream — ${e?.message ?? "unsafe URL"}\n`;
    await log("stderr", msg);
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      provider: "hermes_gateway",
      errorMessage: msg.trim(),
      errorCode: "unsafe_url",
    };
  }

  const persona = readBundleEntry(ctx);

  // V1: enrich system prompt with the skills index from the paperclip-skills-bridge.
  // Hermes does not yet auto-scan well-known endpoints (upstream PR pending), so we
  // tell the model where to fetch SKILL.md from. Only names+descriptions are injected
  // here — full SKILL.md bodies stay server-side (progressive disclosure preserved).
  let skillsCatalog = "";
  const adapterConfigAny = ctx.agent?.adapterConfig as any;
  const rawBridgeUrl =
    pickConfigValue(adapterConfigAny, "skillsBridgeUrl", "SKILLS_BRIDGE_URL") ??
    pickConfigValue(adapterConfigAny, "bridgeUrl", "SKILLS_BRIDGE_URL") ??
    "http://paperclip-skills-bridge:8080";

  let bridgeUrl: string | null = null;
  try { bridgeUrl = validateOutboundUrl(rawBridgeUrl).toString().replace(/\/+$/, ""); }
  catch (e: any) {
    await log("stderr", `Hermes Gateway adapter: refused to call bridge — ${e?.message ?? "unsafe URL"}\n`);
  }

  // companyId auto-discovery: the operator never has to copy/paste the UUID.
  // - If the bridge URL already carries a `/companies/<uuid>` segment, we
  //   honour it verbatim (explicit wins).
  // - Otherwise, we inject `/companies/<ctx.agent.companyId>` automatically.
  //   Paperclip injects the agent's companyId at runtime; legacy bridge mode
  //   also accepts this shape via its compatibility alias.
  if (bridgeUrl) {
    const COMPANY_PATH_RE = /\/companies\/[0-9a-fA-F-]{36}(?:\/|$)/;
    if (!COMPANY_PATH_RE.test(bridgeUrl)) {
      const cid = ctx.agent?.companyId;
      if (typeof cid === "string" && /^[0-9a-fA-F-]{36}$/.test(cid)) {
        bridgeUrl = `${bridgeUrl}/companies/${cid}`;
      }
    }
  }

  if (bridgeUrl) {
    try {
      const bridgeToken = pickConfigValue(adapterConfigAny, "skillsBridgeToken", "SKILLS_BRIDGE_TOKEN");
      const idxHeaders: Record<string, string> = {};
      if (bridgeToken) idxHeaders.Authorization = `Bearer ${bridgeToken}`;
      const idxResp = await fetch(`${bridgeUrl}/.well-known/skills/index.json`, {
        headers: idxHeaders,
        signal: AbortSignal.timeout(3000),
      });
      if (idxResp.ok) {
        const idx: any = await idxResp.json();
        const allEntries: any[] = Array.isArray(idx?.skills) ? idx.skills : [];
        // Honour the agent's selected skill set instead of pasting the whole
        // company catalog into every wake. Paperclip stores it on the agent
        // as `adapterConfig.paperclipSkillSync.desiredSkills` — entries are
        // namespaced like "paperclipai/paperclip/<name>" or
        // "local/<hash>/<name>"; the bridge index.json publishes only the
        // leaf <name>, so we match by suffix.
        const desiredSkills: unknown = adapterConfigAny?.paperclipSkillSync?.desiredSkills;
        const desiredList: string[] = Array.isArray(desiredSkills)
          ? desiredSkills.filter((s): s is string => typeof s === "string")
          : [];
        const entries: any[] = desiredList.length > 0
          ? allEntries.filter(s => {
              const name = typeof s?.name === "string" ? s.name : "";
              if (!name) return false;
              return desiredList.some(d => d === name || d.endsWith("/" + name));
            })
          : allEntries;
        if (entries.length > 0) {
          const blocks: string[] = entries.map(s => {
            const desc = (s.description || "").trim().slice(0, 200);
            const files: string[] = Array.isArray(s.files) && s.files.length > 0
              ? s.files
              : ["SKILL.md"];
            // Lead with SKILL.md (the entry) so the model knows where to
            // start; references / templates come after, fetched lazily.
            const sortedFiles = files
              .slice()
              .sort((a, b) => (a === "SKILL.md" ? -1 : b === "SKILL.md" ? 1 : a.localeCompare(b)));
            const fileLines = sortedFiles.map(f => `  - ${bridgeUrl}/.well-known/skills/${s.name}/${f}`);
            return `### ${s.name}\n${desc}\n\nFiles (HTTP GET):\n${fileLines.join("\n")}`;
          });
          const authNote = bridgeToken
            ? "These URLs require the request header `Authorization: Bearer " + bridgeToken + "` (the same token applies to every file in this catalog). Use whichever HTTP-capable tool you have available."
            : "These URLs accept anonymous HTTP GET from inside the deployment network. Use whichever HTTP-capable tool you have available.";
          skillsCatalog = [
            "## Skills available via the Paperclip skills bridge",
            "",
            "Each skill below exposes an entry `SKILL.md` and optionally reference / template / example files.",
            "Read `SKILL.md` first for the skill whose domain matches the task; fetch reference files only when their depth is needed.",
            authNote,
            "",
            blocks.join("\n\n"),
          ].join("\n");
        }
      }
    } catch {
      // ignore: bridge may be offline; carry on without skills catalog
    }
  }

  // Paperclip's ctx may carry the wakeup prompt under several keys depending on the
  // call-path (heartbeat vs assign-task vs resume). Probe in order; fall back to a
  // generic "wake" instruction so the LLM still answers off AGENTS.md alone.
  const ctxAny = ctx as any;
  const userPrompt = String(
    ctxAny.prompt ??
    ctxAny.task ??
    ctxAny.taskBody ??
    ctxAny.message ??
    ctxAny.body ??
    ctxAny.input ??
    "Heartbeat. Follow the instructions in your system message and do the task it asks for."
  );

  const systemParts: string[] = [];
  if (persona) systemParts.push(persona);
  if (skillsCatalog) systemParts.push(skillsCatalog);

  const messages: ChatMessage[] = [];
  if (systemParts.length > 0) messages.push({ role: "system", content: systemParts.join("\n\n---\n\n") });
  messages.push({ role: "user", content: userPrompt });

  // Note: we used to emit a "[hermes-gateway] dispatching …" counter line to
  // stderr for debugging — that polluted the Paperclip Run UI's stderr panel
  // even on successful wakes. We log it through `app.log` (operator-side
  // observability) and keep stderr exclusively for actual error conditions.

  const body: Record<string, unknown> = {
    messages,
    stream: false,
  };
  if (cfg.model) body.model = cfg.model;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiKey}`,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };
  if (ctx.runId) headers["X-Paperclip-Run-Id"] = ctx.runId;

  const baseUrl = validatedHermesUrl.toString().replace(/\/+$/, "");
  const url = `${baseUrl}/chat/completions`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutSec * 1000),
    });

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      const safe = sanitizeErrorText(errBody);
      const msg = `Hermes API HTTP ${resp.status}: ${safe}\n`;
      await log("stderr", msg);
      return {
        exitCode: 1,
        signal: null,
        timedOut: false,
        provider: "hermes_gateway",
        errorMessage: msg.trim(),
        errorCode: `http_${resp.status}`,
      };
    }

    const data: any = await resp.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";

    // Pipe assistant text into the run's stdout so the user sees it in the Runs UI.
    if (content) await log("stdout", content);

    // Normalize Hermes' OpenAI-compatible `usage` (prompt_tokens / completion_tokens
    // / prompt_tokens_details.cached_tokens) into the snake-vs-camel field names
    // Paperclip expects on AdapterExecutionResult.
    const rawUsage = data?.usage ?? {};
    const usage = {
      inputTokens: typeof rawUsage.prompt_tokens === "number" ? rawUsage.prompt_tokens : undefined,
      outputTokens: typeof rawUsage.completion_tokens === "number" ? rawUsage.completion_tokens : undefined,
      cachedInputTokens:
        typeof rawUsage?.prompt_tokens_details?.cached_tokens === "number"
          ? rawUsage.prompt_tokens_details.cached_tokens
          : undefined,
    };
    const hasUsage =
      usage.inputTokens !== undefined ||
      usage.outputTokens !== undefined ||
      usage.cachedInputTokens !== undefined;

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      provider: "hermes_gateway",
      model: typeof data?.model === "string" ? data.model : undefined,
      summary: content || undefined,
      ...(hasUsage ? { usage } : {}),
      resultJson: {
        id: data?.id,
        model: data?.model,
        finish_reason: data?.choices?.[0]?.finish_reason,
      },
    };
  } catch (err: any) {
    const isTimeout = err?.name === "AbortError" || err?.name === "TimeoutError";
    const errMsg = isTimeout
      ? `Hermes API request timed out after ${cfg.timeoutSec}s`
      : `Hermes API request failed: ${sanitizeErrorText(err?.message ?? err)}`;
    await log("stderr", errMsg + "\n");
    return {
      exitCode: isTimeout ? 124 : 1,
      signal: null,
      timedOut: isTimeout,
      provider: "hermes_gateway",
      errorMessage: errMsg,
      errorCode: isTimeout ? "timeout" : "request_failed",
    };
  }
}
