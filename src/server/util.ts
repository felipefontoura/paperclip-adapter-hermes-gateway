// Internal utilities shared by execute.ts and test.ts.

import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import type { HermesGatewayConfig } from "../shared/types";
import { DEFAULT_URL, DEFAULT_TIMEOUT_SEC } from "../shared/constants";

// ---------------------------------------------------------------------------
// SSRF guard — block private / loopback / link-local / cloud-metadata targets
// ---------------------------------------------------------------------------

/** Hostnames known to expose cloud metadata; blocked unconditionally. */
const BLOCKED_HOSTNAMES = new Set<string>([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
  "metadata.azure.com",
  "metadata.aws",
]);

function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split(".").map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(p => !Number.isFinite(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 127) return true;                            // 127.0.0.0/8 loopback
  if (a === 10) return true;                             // 10.0.0.0/8 private
  if (a === 192 && b === 168) return true;               // 192.168.0.0/16 private
  if (a === 172 && b >= 16 && b <= 31) return true;      // 172.16.0.0/12 private
  if (a === 169 && b === 254) return true;               // 169.254.0.0/16 link-local + AWS metadata
  if (a === 0) return true;                              // 0.0.0.0/8
  if (a >= 224) return true;                             // multicast + reserved
  return false;
}

function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;    // unspecified + loopback
  if (lower.startsWith("fe80:")) return true;            // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local
  if (lower.startsWith("ff")) return true;               // multicast
  return false;
}

/**
 * Validate a user-supplied URL before the adapter fetches it.
 * Accepts only `http://` and `https://`; rejects loopback, private RFC1918,
 * link-local, cloud-metadata and other internal targets.
 *
 * Throws Error("unsafe URL: ...") with a small reason string on rejection.
 */
export function validateOutboundUrl(raw: string): URL {
  let parsed: URL;
  try { parsed = new URL(raw); }
  catch { throw new Error("unsafe URL: not a valid URL"); }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`unsafe URL: scheme "${parsed.protocol}" is not allowed`);
  }

  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new Error(`unsafe URL: hostname "${host}" is blocked`);
  }
  if (host.endsWith(".svc.cluster.local") || host.endsWith(".cluster.local")) {
    throw new Error("unsafe URL: cluster-internal hostnames are blocked");
  }

  // If host parses as an IP, run CIDR checks directly. Otherwise we rely on
  // the hostname allowlist and the fact that DNS resolution happens in a
  // controlled environment (no user-controlled wildcard CNAMEs in V1).
  const ipv4Family = net.isIPv4(host);
  if (ipv4Family && isBlockedIPv4(host)) {
    throw new Error(`unsafe URL: IPv4 ${host} is in a blocked range`);
  }
  const ipv6Family = net.isIPv6(host);
  if (ipv6Family && isBlockedIPv6(host)) {
    throw new Error(`unsafe URL: IPv6 ${host} is in a blocked range`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Error sanitizing — strip tokens, truncate, normalize
// ---------------------------------------------------------------------------

const TOKEN_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._\-+/=]+/gi,
  /\bsk-[A-Za-z0-9]{16,}\b/g,             // OpenAI-style keys
  /\bsk-or-v\d+-[A-Za-z0-9]+\b/g,         // OpenRouter
  /\bey[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]+\b/g, // JWT
  /\bgsk_[A-Za-z0-9]{16,}\b/g,            // Groq
  /\b[a-f0-9]{32}\.[A-Za-z0-9]{12,}\b/g,  // Z.ai-style keys
];

/**
 * Strip token-like substrings and truncate to a safe length.
 * Use on upstream error bodies before logging or forwarding them.
 */
export function sanitizeErrorText(input: unknown, maxLen = 200): string {
  let s = typeof input === "string" ? input : String(input ?? "");
  for (const re of TOKEN_PATTERNS) s = s.replace(re, "[redacted]");
  if (s.length > maxLen) s = s.slice(0, maxLen) + "…";
  return s;
}

export function cfgString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function cfgNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export interface ResolvedConfig {
  url: string;
  apiKey: string | undefined;
  model: string | undefined;
  timeoutSec: number;
}

/** Hermes API server has a server-side maximum of 30 minutes; clamp here too. */
const TIMEOUT_SEC_MIN = 1;
const TIMEOUT_SEC_MAX = 1800;

function clampTimeoutSec(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_TIMEOUT_SEC;
  return Math.min(TIMEOUT_SEC_MAX, Math.max(TIMEOUT_SEC_MIN, Math.floor(raw)));
}

/**
 * Look up a config field, accepting any of these wiring points (first hit wins):
 *
 *  1. Top-level `adapterConfig.<key>` set via API PATCH.
 *  2. Per-agent "Environment variables" the operator typed in the Paperclip UI,
 *     surfaced as `adapterConfig.env[<KEY>]` (e.g. `HERMES_URL`, `HERMES_API_KEY`).
 *  3. Process env var of the same name — used by single-tenant single-instance
 *     deployments that prefer container-level configuration.
 *
 * This three-tier lookup means the same plugin code works whether the operator
 * configures via UI form, via UI env-vars, or via direct API PATCH.
 */
export function pickConfigValue(
  rawConfig: any,
  keyOnObject: string,
  envKey: string,
): string | undefined {
  const direct = cfgString(rawConfig?.[keyOnObject]);
  if (direct) return direct;
  const envBlock = rawConfig?.env;
  if (envBlock && typeof envBlock === "object") {
    const fromUiEnv = cfgString(envBlock[envKey]);
    if (fromUiEnv) return fromUiEnv;
  }
  const fromProcess = cfgString(process.env[envKey]);
  if (fromProcess) return fromProcess;
  return undefined;
}

export function resolveConfig(raw: HermesGatewayConfig | unknown): ResolvedConfig {
  const cfg = (raw ?? {}) as any;
  return {
    url: pickConfigValue(cfg, "url", "HERMES_URL") ?? DEFAULT_URL,
    apiKey: pickConfigValue(cfg, "apiKey", "HERMES_API_KEY"),
    model: pickConfigValue(cfg, "model", "HERMES_MODEL"),
    timeoutSec: clampTimeoutSec(cfgNumber(cfg.timeoutSec) ?? cfgNumber(cfg?.env?.HERMES_TIMEOUT_SEC) ?? cfgNumber(process.env.HERMES_TIMEOUT_SEC)),
  };
}

// Read the Paperclip "managed bundle" entry file (typically AGENTS.md) from disk.
// Safe — returns "" if file is missing or PAPERCLIP_HOME is not set.
export function readBundleEntry(ctx: any): string {
  try {
    const config = ctx?.agent?.adapterConfig ?? {};

    // 1) Explicit path wins (Paperclip injects instructionsFilePath at runtime
    //    when supportsInstructionsBundle is true on the adapter).
    const explicit = cfgString(config?.instructionsFilePath);
    if (explicit && path.isAbsolute(explicit) && fs.existsSync(explicit)) {
      return fs.readFileSync(explicit, "utf8");
    }

    // 2) Managed bundle default location.
    const home = process.env.PAPERCLIP_HOME || "/paperclip";
    const instance = process.env.PAPERCLIP_INSTANCE_ID || "production";
    const entry = cfgString(config?.instructionsEntryFile) || "AGENTS.md";
    const cid: string | undefined = ctx?.agent?.companyId;
    const aid: string | undefined = ctx?.agent?.id;
    if (!cid || !aid) return "";

    const full = path.join(home, "instances", instance, "companies", cid, "agents", aid, "instructions", entry);
    if (!fs.existsSync(full)) return "";
    return fs.readFileSync(full, "utf8");
  } catch {
    return "";
  }
}
