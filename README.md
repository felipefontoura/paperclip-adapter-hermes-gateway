# @felipefontoura/paperclip-adapter-hermes-gateway

Connects your Paperclip agents to a [Hermes Agent](https://github.com/NousResearch/hermes-agent) over HTTP.
No Hermes CLI inside Paperclip, no bind mounts, no upstream patches.

Works together with [`@felipefontoura/paperclip-skills-bridge`](https://github.com/felipefontoura/paperclip-skills-bridge), which exposes your Paperclip skills to Hermes.

## How it works

```
Paperclip agent ── HTTPS ──▶ Hermes Agent  (chat completions)
       │
       └────── HTTPS ──▶ paperclip-skills-bridge ──▶ Paperclip API  (skills)
```

Three independent HTTPS calls, three independent bearers. The bridge is optional — without it the agent just talks to Hermes with whatever instructions you wrote in AGENTS.md.

## Install

1. Open **Company Settings → Instance Settings → Adapters** in Paperclip.
2. Click **Install Adapter** → **npm package**.
3. Fill in:
   - **Package Name:** `@felipefontoura/paperclip-adapter-hermes-gateway`
   - **Version:** `latest` (or pin to `0.1.0`)
4. Click **Install**, then restart Paperclip when prompted.

After the restart, `Hermes (gateway)` appears in the **Adapter type** dropdown when you create or edit an agent.

## Configure an agent

In the agent's **Configuration** tab:

1. **Adapter type:** select `Hermes (gateway)`.
2. **Model:** the model name your Hermes server exposes (e.g. `hermes-agent`, `glm-5.1`). Leave blank to use the Hermes default.
3. **Timeout (sec):** how long the adapter waits for Hermes (default `120`, clamped to 1–1800).
4. **Environment variables:** add these four entries (use **Seal** for secrets):

   | Key | Value | Required |
   |---|---|---|
   | `HERMES_URL` | OpenAI-compatible base URL of your Hermes server, e.g. `https://hermes.example.com/v1` | yes |
   | `HERMES_API_KEY` | Matches `API_SERVER_KEY` on the Hermes container | yes |
   | `SKILLS_BRIDGE_URL` | Base URL of the skills bridge, e.g. `https://skills.example.com` | only if you want skills |
   | `SKILLS_BRIDGE_TOKEN` | The bridge's `BRIDGE_AUTH_TOKEN` (or per-tenant token) | only if you set `SKILLS_BRIDGE_URL` |

That's it. Click **Run Heartbeat** in the agent header and Hermes answers.

> The bridge URL doesn't need to include your company UUID — the adapter discovers it automatically and appends `/companies/<id>` for you.

## Where the company UUID lives (you usually don't need it)

If you ever do need the UUID (e.g. you're administering the bridge), ask the bridge:

```bash
curl https://skills.example.com/whoami -H "Authorization: Bearer $SKILLS_BRIDGE_TOKEN"
# → {"companyId":"af724ed6-612e-466b-b733-dd00e0371236"}
```

## Roadmap

- **v0.1.0** — Single + multi-tenant bridge, SSRF guard, references support, ETag passthrough, auto-discovery of the company UUID.
- **v0.2.0** — In-memory cache for the skills index, richer UI fields once Paperclip supports them upstream.
- **v0.3.0** — Streaming responses, session resume.

## License

MIT — see [LICENSE](LICENSE).
