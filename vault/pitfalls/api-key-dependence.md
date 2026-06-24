---
title: "API Key Dependence"
category: "pitfalls"
status: researched
priority: high
related:
  - "Web App With Backend Renderer"
  - "OpenRouteService"
source_urls:
  - "https://openrouteservice.org/restrictions/"
---

# API Key Dependence

## Risk
Hosted APIs can change limits, pricing, or terms.

## Why It Matters
Journey Book should not break because a free tier changes.

## Mitigation
Abstract providers and keep self-host/offline fallback paths.

## Prototype Check
Run sample atlas generation with network disabled.

See also: [[Web App With Backend Renderer]], [[OpenRouteService]]
