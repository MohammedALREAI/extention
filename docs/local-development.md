# Running the extension against a local server

The extension API normally checks, in order: a signed token, a user row, a subscription
row, a policy row, then the model gateway.

## Fast path — no database (recommended for testing detection)

`CF_DEV_NO_AUTH=1` skips the token, user, subscription and policy lookups, so the only
thing you must supply is model credentials. It is double-gated — it is ignored whenever
`NODE_ENV=production`, so it cannot open a deployed endpoint.

1. `.env` (already created for you):
   ```
   PORT=3001
   CF_DEV_NO_AUTH=1
   CF_DEV_RULES=dog
   BUILT_IN_FORGE_API_URL=https://your-gateway.example.com
   BUILT_IN_FORGE_API_KEY=your-key
   ```
   The rules come from `CF_DEV_RULES`, since with no database there is no stored policy.
2. `npm run dev`
3. `npx tsx scripts/dev_snapshot.ts dog` — prints a snapshot pointing at
   `http://localhost:3001`. Paste it into the extension → Protection rules → Import.
   Keep its terms the same as `CF_DEV_RULES`.
4. Open a search page. Without valid credentials every check fails and the popup
   reports it.

## Running the Python API during the migration

The `api/` package implements the same frozen extension wire contract as the Node API.
To point a development snapshot at Python instead, start the ASGI app with the same
development flags and choose its base URL when generating the snapshot:

```bash
cd api
python -m pip install -e '.[web,dev]'
CF_DEV_NO_AUTH=1 CF_DEV_RULES=dog \
  BUILT_IN_FORGE_API_URL="$BUILT_IN_FORGE_API_URL" \
  BUILT_IN_FORGE_API_KEY="$BUILT_IN_FORGE_API_KEY" \
  python -m uvicorn contentfirewall.main:app --app-dir src --host 127.0.0.1 --port 8000
```

In a second terminal, generate an importable snapshot for Python:

```bash
CF_EXTENSION_API_BASE=http://127.0.0.1:8000/api/extension \
  npx tsx scripts/dev_snapshot.ts dog
```

The extension sends the same `POST /semantic-evaluate` and
`POST /visual-localize` requests to either implementation. Do not use the bypass in
production; configure `DATABASE_URL` and `CF_EXTENSION_TOKEN_SECRET` instead.

### Choosing a provider

Any OpenAI-compatible gateway works. Model **names** are provider-specific, so a switch
needs both variables:

| Provider | `BUILT_IN_FORGE_API_URL` | Model names |
| --- | --- | --- |
| OpenAI | `https://api.openai.com` | `CF_MODEL_VISUAL=gpt-4o`, `CF_MODEL_SEMANTIC=gpt-4o-mini` |
| OpenRouter | `https://openrouter.ai/api` | `CF_MODEL_VISUAL=google/gemini` (prefix match) |
| Existing gateway | whatever your deployment already uses | leave the model variables empty |

The visual route needs a model that accepts images. If the names do not match anything
the provider lists, the error says exactly what it looked for and what is available:

```
No model matches route "visual". Looked for ids starting with: gemini-3.1-pro-preview, …
Set CF_MODEL_VISUAL to names your provider offers. Available: gpt-4o, gpt-4o-mini, …
```

The full path below exercises the real auth chain instead, and needs a database.

## 1. A MySQL database

This machine has no MySQL client, no Docker and nothing on port 3306, so start one:

- **Docker** (simplest, if you install Docker Desktop):
  ```
  docker run --name cf-mysql -e MYSQL_ROOT_PASSWORD=password -e MYSQL_DATABASE=content_firewall -p 3306:3306 -d mysql:8
  ```
- **Native MySQL 8**: install it, then `CREATE DATABASE content_firewall;`
- **Hosted**: any MySQL 8 provider works; use its connection string.

## 2. Environment

```
cp .env.example .env
```

Fill in at minimum:

| Variable | Why |
| --- | --- |
| `DATABASE_URL` | Every extension API call reads user, subscription and policy rows |
| `JWT_SECRET` | Signs the extension access token; any long random string |
| `BUILT_IN_FORGE_API_URL` | Base URL of an OpenAI-compatible gateway, no trailing slash |
| `BUILT_IN_FORGE_API_KEY` | Its key. **Without this nothing is ever detected** |

`OAUTH_SERVER_URL` and friends can stay empty — the seed script creates the user
directly, so you never sign in through the web app.

## 3. Schema and seed data

```
npm run db:push            # creates the tables
npx tsx scripts/seed_local.ts dog
```

The seed creates one user, one running trial subscription and one policy, then prints a
policy snapshot pointing at `http://localhost:3001`. Pass different terms to block
something else (`npx tsx scripts/seed_local.ts cat car`). Re-running replaces the policy.

## 4. Server and extension

```
npm run dev                # http://localhost:3001
```

In `chrome://extensions`, reload the unpacked `extension/` folder. `host_permissions`
already allows `http://localhost/*` for exactly this, and `validate_extension.mjs`
permits loopback while still rejecting any other insecure host.

Open the extension's **Protection rules**, paste the snapshot the seed printed into
**Import policy snapshot**, and import it.

## 5. Verify

Open `http://localhost:3001/eval/acceptance-page.html` (see `eval/README.md` — you supply
the images) or any search page.

**Check the toolbar popup first.** It reports how many checks could not complete and why:

| Popup says | Meaning |
| --- | --- |
| nothing | Every check completed. If nothing is covered, the model found nothing |
| Visual checking is not authorized | Token rejected — re-run the seed, and check `JWT_SECRET` matches the one the token was signed with |
| trial or subscription access has ended | The subscription row is not in a running trial; re-run the seed |
| The vision service did not answer in time | Gateway slow, unreachable, or `BUILT_IN_FORGE_API_URL` is wrong |

A failed check draws nothing on the page, exactly like a clean image — the popup is the
only thing that tells them apart.

## Before shipping

`host_permissions` currently lists **only** loopback. The extension cannot reach a
deployed API until you add that host:

```json
"host_permissions": ["http://localhost/*", "http://127.0.0.1/*", "https://api.example.com/*"]
```
