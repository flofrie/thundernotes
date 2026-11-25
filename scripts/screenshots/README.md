# Screenshots

`take.sh` regenerates the pictures in `docs/screenshots/` from the add-on's own built pages:

```sh
scripts/screenshots/take.sh              # all: email notes options tasks tetris
scripts/screenshots/take.sh tasks notes  # only some
```

It needs Google Chrome (set `CHROME=` if it isn't in `/Applications`) and `python3`. It builds the add-on, copies the pages to a temporary folder, serves them on `127.0.0.1:8765` (`PORT=` to change) and takes each shot with headless Chrome at twice the resolution.

What is real and what isn't:
- The pages, their scripts and styles are the built add-on, unchanged.
- `mock.js` stands in for Thunderbird's API (`messenger`), with invented sample notes (`example.org` only), label colours and a small in-memory IndexedDB (headless Chrome's own never answers under virtual time).
- `email.html` is an invented email with the email view's display script (`dist/content.js`); `render-entry.ts` bundles core's `renderMarkdown` for it, as the background renders notes in Thunderbird.
- `clock.js` pins today to 2026-11-13, so the task groups (Overdue, Next 7 days …) match the sample dates whenever the shots are taken.
- `autoplay.js` plays a few pieces of Tetris; the pieces are random, so that shot differs each time.
- No Thunderbird window around the pages; the lines from note cards to their passages don't show in the email shot.

When a page's script tag or a message the pages send changes, adjust `take.sh` or `mock.js`.
