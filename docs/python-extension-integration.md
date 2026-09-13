# Python API Integration for the Chrome Extension

## Overview

The extension can use the existing Node API or the Python FastAPI service for semantic text evaluation and visual object localization. The Node server remains the policy and account entry point. When `CF_PYTHON_API_URL` is configured, the Node policy-export mutation points the extension at Python while preserving the existing HMAC extension token and wire contract.

## Environment

Node service:

```env
CF_PYTHON_API_URL=http://127.0.0.1:8000
CF_EXTENSION_TOKEN_SECRET=local-dev-secret
```

Python service:

```env
CF_ENV=development
CF_EXTENSION_TOKEN_SECRET=local-dev-secret
BUILT_IN_FORGE_API_URL=https://model-gateway.example.com
BUILT_IN_FORGE_API_KEY=replace-with-a-real-key
DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/contentfirewall
```

The Node and Python services must use the same extension-token secret. `CF_DEV_NO_AUTH=1` is allowed only for local development without a database and must never be enabled in production.

Start Python with:

```bash
cd api
uv sync --extra web --extra data --extra imaging
uv run uvicorn contentfirewall.main:app --host 0.0.0.0 --port 8000
```

Verify liveness:

```bash
curl http://127.0.0.1:8000/healthz
# {"status":"ok"}
```

## Policy export

The Node mutation `firewall.policies.extensionAccess` returns the normal extension snapshot. With `CF_PYTHON_API_URL` configured, the semantic and visual endpoints become:

```json
{
  "endpoint": "http://127.0.0.1:8000/api/extension/semantic-evaluate",
  "visualEndpoint": "http://127.0.0.1:8000/api/extension/visual-localize",
  "token": "<policy-token>",
  "expiresAt": 1760000000000
}
```

## Semantic payload

`POST /api/extension/semantic-evaluate` accepts a bearer token and a bounded JSON body:

```json
{
  "rules": ["gambling", "قمار"],
  "results": [{"id": "result-1", "text": "A guide to gambling offers"}]
}
```

Success is a top-level array. IDs are echoed exactly:

```json
[
  {
    "id": "result-1",
    "decision": "blur",
    "confidence": 0.96,
    "reason": "The result is about gambling.",
    "matchedText": ["gambling"],
    "source": "semantic"
  }
]
```

An unavailable model returns HTTP 502. The extension treats it as uncertain and does not silently allow the result.

## Visual payload

`POST /api/extension/visual-localize` accepts up to six image candidates:

```json
{
  "rules": ["cat", "قطة"],
  "images": [{
    "id": "image-1",
    "url": "https://cdn.example.com/result.jpg",
    "width": 1200,
    "height": 800,
    "context": "A mixed cat and dog photo"
  }]
}
```

A match returns normalized boxes. No-match returns the same ID with an empty `boxes` array. Failure returns `status: "unavailable"` and no boxes. A missing response is never interpreted as a confident no-match.

## Security and migration

The Python service accepts only HTTPS image URLs or bounded inline image data URLs. It does not retain image bytes. Production deployments must use HTTPS, a real PostgreSQL database, a real model gateway, explicit CORS policy, and no development auth bypass.

| Check | Expected result |
| --- | --- |
| `/healthz` | HTTP 200 and `{"status":"ok"}` |
| Shared token secret | Same value in Node and Python |
| Policy export | Endpoints point to `CF_PYTHON_API_URL` |
| Semantic body | Contains `rules` and `results` |
| Visual body | Contains `rules` and bounded `images` |
| Failed model call | Explicit unavailable/HTTP 502 |
| Production auth | `CF_DEV_NO_AUTH` is absent |

## References

[1]: https://fastapi.tiangolo.com/deployment/ "FastAPI deployment documentation"
[2]: https://www.uvicorn.org/deployment/ "Uvicorn deployment documentation"
[3]: https://developer.chrome.com/docs/extensions/develop/concepts/network-requests "Chrome extension network requests"
[4]: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS "MDN CORS documentation"
