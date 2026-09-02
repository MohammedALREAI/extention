# Acceptance page for object-level filtering

`acceptance-page.html` is the end-to-end check that the extension filters *objects*
rather than deciding whether to block whole images. It is deliberately not a Google
search page: results change hourly, which makes a regression impossible to attribute.

## Supplying the images

The page references eleven files under `eval/images/` that **are not in this
repository**. Per `docs/image-evaluation.md` this project carries no fabricated or
unlicensed image data, so you provide rights-cleared photographs and drop them in with
these names:

| File | Must contain |
| --- | --- |
| `01-dog-and-cat.jpg` | One dog and one cat, clearly separated |
| `02-cat-only.jpg` | A cat, no dog anywhere |
| `03-dog-and-person.jpg` | A dog and a person |
| `04-car-and-person.jpg` | A car and a person, no animals |
| `05-small-background-dog.jpg` | A scene whose dog is small and in the background |
| `06-cat-titled-dog.jpg` | **A cat and no dog** — the page titles it "Dog" on purpose |
| `07-dog-banner.jpg` | A dog, for the page header |
| `08-dog-dynamic.jpg` | A dog, inserted 1.5s after load |
| `09-multiple-dogs.jpg` | Several dogs in different parts of the frame |
| `10-no-blocked-objects.jpg` | A landscape with no animals or vehicles |
| `11-dog-footer.jpg` | A dog, for the page footer |

## Running it

1. `npm run dev`, then open **`http://localhost:3001/eval/acceptance-page.html`**. The
   content script only runs on `http(s)` pages, so a `file://` path will not do. This
   directory is mounted at `/eval` in development only; the fixture is never part of a
   production build.
2. Block `dog` in the extension options, then reload the page.
3. Open the toolbar popup **first**. If it reports checks that could not complete, fix
   that before judging anything: an unchecked image and a clean image look identical.

## What passing means

- Dogs covered in 1, 3, 5, 7, 8, 9 and the footer image — including the banner and
  footer, which sit outside the main content region.
- Cats, people, cars and scenery in those same pictures left visible.
- **6 untouched.** Its `alt` and `title` both say "Dog" while the picture is a cat. A
  cover here means captions are being trusted as evidence, which is the specific failure
  the caption-as-hint rule exists to prevent.
- **2, 4 and 10 untouched.**
- 8 covered even though it did not exist at first paint.

Then swap the rule to `cat` and reload: the results must invert with no code change. If
they do not, the behaviour is keyed to a particular word rather than to the policy.
