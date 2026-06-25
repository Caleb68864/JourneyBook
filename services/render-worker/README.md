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

## Development

```bash
pnpm --filter @journeybook/render-worker build
PORT=8090 GENERATED_DIR=data/generated node dist/server.js
```
