# Blur & Object Detection — How It Works

How a matching object in a search-result image goes from model output to the patch a
user sees, and which knob to turn when the result looks wrong.

## The path an image takes

1. **Candidate collection** (`extension/content.js`) — every image currently on screen
   in the page's content regions, not only inside text result cards: a knowledge panel,
   a video shelf, a banner and a footer all carry images worth protecting
   (`imageRegionsForDocument` in `extension/engines.js`). At least 64×64, the largest
   first, capped at 16 per scan, with off-screen images deferred to the scan triggered
   when they scroll into view. Each gets a short id keyed on a digest of its source
   (`extension/imageSource.js`), because the API bounds ids and a truncated one comes
   back unmatched.
2. **Localization** (`server/visualLocalization.ts`) — a model call returns boxes in a
   normalized 1000×1000 space, then validation and deduplication run server-side.
3. **Rendering** (`extension/imageMask.js` + `extension/content.css`) — each surviving
   box becomes one feathered patch over the object.

Three outcomes stay separated: **match** → patches on the objects only; **no match** →
nothing drawn; **failure** → also nothing drawn, by product choice, with the count and
reason reported in the toolbar popup instead. Because a failed check now looks like a
clean page, the popup is the only place that distinguishes them — check it first when
nothing appears to be filtered.

## Detection quality (server)

### Validation, in order

Every box must pass all of these or it is dropped — one bad box never fails the batch:

| Check | Rule |
| --- | --- |
| Geometry | finite numbers, inside 0–1000, positive size |
| Confidence | adaptive, see below |
| Area | `1200` normally; `max(800, 1200 × 0.4)` for an edge box |
| Aspect ratio | longest side ≤ 12× the shortest |

### Adaptive confidence

A partly visible object scores lower simply because less of it is there, so an
edge-clipped box is judged more leniently. A box claiming most of the frame is judged
more strictly, since "the whole image is a dog" is the model's most common overreach.

- `MIN_VISUAL_CONFIDENCE_EDGE = 0.55` — touching any boundary within 0.5%
- `MIN_VISUAL_CONFIDENCE = 0.62` — normal
- `MIN_VISUAL_CONFIDENCE_LARGE = 0.75` — area over 30% of the image

**Size is tested before position**, and the order is load-bearing: a box covering most of
the frame also touches every boundary, so testing for an edge first would hand the
loosest threshold to exactly the whole-image claim the strict floor exists to stop.

The normal and edge floors are tuned for recall — a background or partly hidden instance
is the miss that matters — at the cost of an occasional wrong cover, which one click
reveals.

### Deduplication

Two rules, applied to boxes sorted by confidence:

- **Spatial** — IoU ≥ 0.55 with a kept box, regardless of label.
- **Containment, label-aware** — ≥ 75% of the box lies inside a stronger box *with the
  same label*. This is the same object found twice at different scales.

The label condition is what keeps a cat sitting on a dog: high containment, different
label, so both boxes survive. Without it the smaller animal would silently vanish.

### Prompt

`localizeVisualMatches` states the rules the validator enforces — partial objects
(box the visible portion only), overlapping objects (separate boxes, never merged),
and scale variance (small does not mean skip). The thresholds are quoted into the
prompt so the model's own reporting matches what the parser will accept. Depictions —
illustrations, cartoons, logos, statues, plush toys — are stated to count as matches, so
that behaviour is a decision rather than a coin flip per call.

### Caption context: a hint that never decides

Each image is sent with the text a reader sees beside it — `alt`, `title`, `aria-label`,
a `figcaption`, or the heading of the block it sits in (`extension/imageContext.js`).
The prompt uses it only to know *what to look for*: a box may be returned only for an
object visible in the pixels. A caption naming a filtered term while the picture shows
nothing of the kind yields no box, and a picture containing the object is boxed even when
the caption says nothing.

That text is page-controlled and therefore hostile input. Two boundaries hold it:
`describeImage` strips control characters, zero-width characters and bidi overrides and
bounds the result to 180 characters; `normalizeVisualRequestImages` repeats that
sanitisation server-side at 200 characters, and the prompt labels the value as untrusted
data alongside the existing instruction about text inside images. Test TC-42/TC-43 in
`eval/README.md` — image 6 of the acceptance page — is the regression check.

## Blur rendering (client)

### Why the patch is bigger than the box

The patch fades at its edges rather than ending on a hard rectangle, so it is laid out
*past* the detection on every side. The feather then falls entirely outside the
detected object, which stays under the fully opaque core.

The margin adapts to how much of the image the object occupies — 18% for a small
object down to 10% for a dominant one (`adaptiveMargin`), interpolated between the 5%
and 25% area ratios. A fraction alone breaks down on a small thumbnail, where 18% of a
small box is under one rendered pixel, so `marginUnits` also applies a 6px floor
converted back into normalized units using the image's real dimensions.

### Size and edge attributes

`applyBoxes` stamps each patch with what CSS needs:

- `data-cf-size` — `tiny` (<1.2% of the image), `small` (<5%), `medium`, or `large`
  (>25%). Drives blur radius: 10px / 16px / 24px / 34px. Detection reaches down to 0.12%
  of an image, and a 24px radius over a patch that small is just a grey dot; a large one
  needs more than the default to stay unreadable.
- `data-cf-edge-left|top|right|bottom` — set when the box sits within 0.5% of that
  boundary. The matching CSS rule sets that side's fade stop to the extreme, so the
  feather is dropped where there is no background to fade into — only the clipped
  object. Corner combinations need no extra rules: both variables simply apply.
- `data-cf-intensity` — only when the user chose a fixed strength.

The four fade stops are CSS custom properties on `.cf-object-mask`, consumed by one
pair of crossed `linear-gradient` masks composited with `mask-composite: intersect`.

### Overlap

`.cf-image-mask-layer` sets `isolation: isolate` so two patches crossing do not
compound into a darker seam. `mix-blend-mode: multiply` would produce exactly that
seam and is deliberately not used.

## Blur strength control

`blurIntensity` on the policy: `auto` (default, size-adaptive), `light` (12px),
`medium` (22px), `strong` (40px). Set in the extension's options page under **Blur
strength**; an explicit choice overrides the size class.

## Browser support

The covers hide content with `backdrop-filter`, which blurs what is *behind* the
element — Chrome/Edge 76+, Safari 9+ (prefixed), Firefox 103+. Where it is missing or
a Firefox user has disabled `layout.css.backdrop-filter.enabled`, an `@supports` block
paints a near-solid patch instead. Less elegant, never revealing. A `filter` fallback
would blur the patch element itself, not the image behind it, so it is not used.

CSS masks degrade independently: without `mask-composite` the patch stays a rounded
rectangle, which still covers the detection.

## Tuning guide

| Symptom | Where to look |
| --- | --- |
| Object edges peek out from under the patch | `MARGIN_SMALL` / `MARGIN_LARGE`, or `MIN_FEATHER_PX` on small thumbnails |
| Patch covers too much background | lower `MARGIN_SMALL`; check the box is not oversized server-side |
| Object still recognizable | `--cf-blur` per size class, or set **Blur strength** to Strong |
| A second animal on top of the first is missed | containment threshold `0.75` in `deduplicateBoxes` |
| Clipped object at the frame edge is missed | `MIN_VISUAL_CONFIDENCE_EDGE` and `edgeAreaThreshold()` |
| Whole image blurred as one box | `MIN_VISUAL_CONFIDENCE_LARGE` and `LARGE_AREA_RATIO` |
| Hard rectangle visible at the image border | edge attributes are not being stamped — check `EDGE_THRESHOLD` |
| An image on the page is never checked at all | below `MIN_VISUAL_IMAGE_EDGE`, past `MAX_VISUAL_CANDIDATES`, off screen, or outside every region in `imageRegionsForDocument` |
| Nothing filtered anywhere | open the popup: a failed check draws nothing, so it is indistinguishable from a clean page without it |
| An image blurred because its caption said so | the caption-as-hint rule in the prompt; image 6 of the acceptance page |
| Patch left behind after a resize | the measured geometry is part of the `applyBoxes` signature — check the `resize` listener still fires a scan |

## Known limitations

- Only `<img>` elements are examined. A filtered object rendered as a CSS
  `background-image`, a `<video>` poster, or inside a canvas is not detected.
- A page with more images than the per-scan cap is covered progressively as the reader
  scrolls, not all at once.
- Cross-origin images that the vision service cannot fetch, and inline thumbnails whose
  pixels cannot be read back, are left visible and counted as incomplete checks.

Detection thresholds live in `server/visualLocalization.ts`; rendering constants in
`extension/imageMask.js` and `extension/content.css`. Regression tests for both sit in
`server/visualLocalization.test.ts` and `extension/extension.test.ts`.
