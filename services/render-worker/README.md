# render-worker

Stateless Fastify service that wraps `renderAtlas` for server-side PDF generation. No database, no persistence — accepts a render request, writes a PDF under `GENERATED_DIR`, and returns the result.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/health` | Liveness check — returns `{ "status": "ok" }` |
| `POST` | `/render` | Render an atlas PDF |

### POST /render

**Request body** (`RenderAtlasInput`):

```json
{
  "mode": "location",
  "center": { "lng": -96.7, "lat": 40.8 },
  "scalePresetId": "usgs-7-5-min",
  "tier": 1,
  "outputPath": "my-atlas.pdf"
}
```

`outputPath` is relative to `GENERATED_DIR` — traversal attempts (`../`, absolute paths) are rejected with `400`.

**Response (200)**:

```json
{ "outputPath": "my-atlas.pdf", "pageCount": 1, "attribution": "JourneyBook atlas" }
```

**Error responses**: `400` bad input · `502` tile/upstream failure · `500` unexpected

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8090` | Listening port |
| `GENERATED_DIR` | `data/generated` | Root directory for output PDFs |
| `TILE_CACHE_DIR` | *(unset)* | Where this process may write tile bytes. Unset renders without a disk cache, which is what the compose topology does — the C# proxy owns the shared cache. Deliberately **not** a request field. |
| `TILE_BASE_URL_ALLOWLIST` | *(unset)* | Comma- or whitespace-separated base URLs this worker may be pointed at for tiles. |

### `TILE_BASE_URL_ALLOWLIST`

`tileBaseUrl` arrives on the request body, and this service is unauthenticated by
design. Without an allowlist the only rules that apply are structural (http(s),
no embedded credentials, no query/fragment) plus a refusal of non-routable
destinations — loopback, RFC1918, CGNAT, link-local including
`169.254.169.254`, multicast and reserved literals, and the `localhost` name.
That still leaves every *named* host reachable from this container.

Set it. `infra/compose/docker-compose.yml` sets it to `http://api:8080/api/tiles`,
which is the only destination the API ever sends. Matching is origin plus path
prefix, so `http://api:8080/api/tiles/usgs-topo` is permitted and
`http://api:8080/api/admin` is not.

An allowlisted entry **overrides** the non-routable check, so an operator running
the API beside the worker can name `http://127.0.0.1:5180/api/tiles` and have it
work. Unset means "no allowlist configured", not "permit nothing" — a deployment
that has not been told about this variable keeps rendering.

## Development

```bash
pnpm --filter @journeybook/render-worker build
PORT=8090 GENERATED_DIR=data/generated node dist/server.js
```
