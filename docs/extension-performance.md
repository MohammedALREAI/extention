# Extension Performance Plan

## Current bottlenecks

The original search-page scan walks all result-card selectors and image cards on every debounced DOM mutation. It then builds image ownership maps and can revisit already decided image DOM layers. The visual client has a result cache but no in-flight image-level coalescing, so overlapping scans could issue the same request before its first result is cached. The asynchronous scan itself had no single-flight guard.

## Performance contract

Only cards intersecting a near-viewport margin are eligible for semantic or visual evaluation. In **Strict** mode, a temporary image-only cover is applied only once the candidate image becomes eligible; off-screen images are not fetched, covered, or evaluated. A later intersection schedules one coalesced scan. Browsers without `IntersectionObserver` retain the existing eager behavior as a compatibility fallback.

The scan must be single-flight. Mutations during an active scan request at most one follow-up scan. Decision layers must be idempotent: identical pending, object-box, no-match, and review states do not recreate DOM nodes. Visual requests must be coalesced by image key while in progress and retained in the existing TTL cache after completion.

## Measurements and acceptance checks

The extension records in-memory counters only: scans started/coalesced, visible/deferred cards, semantic candidates, visual candidates, visual cache hits, and visual in-flight joins. Counters remain local to the tab and are not uploaded. Regression tests prove that off-screen candidates create no visual work, duplicate scans coalesce, identical outcomes preserve existing DOM layers, and the three safety outcomes remain unchanged.
