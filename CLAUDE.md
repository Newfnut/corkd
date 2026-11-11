# Cork n Count — Project Documentation
*For Claude: read this file at the start of every session before making any changes.*

---

## Project overview

A shared household wine and beer tracker PWA for Gary and his wife, used mainly on iPhone 14, including in the store to answer "do we already have this?" before buying. Standalone app (separate from Haul & Paws) that shares the same Firebase project and household logins.

**Live URL:** https://newfnut.github.io/corkd/
**Repo / deploy:** GitHub repo `corkd`, served by GitHub Pages (branch `main`, root folder)

Purpose: remember what was tried and liked, what it cost and where it was bought, and how many are on hand. Some are drink-and-done; "keepers" are kept on file even at zero stock so they can be re-bought when seen or on sale. Keep it basic. Gary is not a wine geek.

---

## Firebase (existing `hallarc` project, shared with Haul & Paws)

Same config as Haul & Paws (see `app.js` top). SDK 10.7.1 via ESM from gstatic. Email/password auth, same accounts. After sign-in `users/{uid}.householdId` gives the household.

**Firestore rules:** no change needed. The existing `households/{householdId}/{document=**}` rule already covers everything below. (Note: those rules allow any signed-in user to read/write any household. Tightening would need care because the join-by-code flow queries `households` by `code`.)

**Auth domain:** `newfnut.github.io` should be listed under Firebase Console → Authentication → Settings → Authorized domains.

### Data model

```
households/{hid}/wines/{wineId}
  producer (winery or brewery), name, type, region, keeper (bool, "I'd buy this again"),
  rating (0 = none, 1-5), notes,
  thumbData (tiny base64 JPEG ~14 KB max, for the list), hasPhoto (bool),
  qtyOnHand, lastStore, lastPrice (final price of latest purchase), createdAt, updatedAt

households/{hid}/wines/{wineId}/photo/main
  data (full base64 JPEG, ~350 KB max, loaded only when the detail sheet opens)

households/{hid}/wines/{wineId}/purchases/{purchaseId}
  date (YYYY-MM-DD), store, price, sale (dollars off), finalPrice (price - sale, min 0), qty, createdAt

households/{hid}/cellar-settings/main
  types (array: user-added types only; defaults live in DEFAULT_TYPES in app.js)
  stores (array: remembered store names for quick-pick chips)
```

Rules of the model:
- Photos are NEVER auto-deleted. Removal is manual only ("Remove photo" in the editor). No wipe on any action.
- Wines are never auto-deleted at qty 0.
- Adding a purchase uses one batched write: new purchase + `qtyOnHand` increment + `lastStore`/`lastPrice` + store added to settings.
- Row and detail −/+ change `qtyOnHand` only and never go below 0.
- Writes are fired in the background (not awaited). Firestore persistence makes them show instantly and sync when the signal returns.

---

## File structure

```
index.html      shell only (meta tags, #app, #sheets, script app.js)
styles.css      all CSS, CSS variables throughout, burgundy accent
app.js          all logic as one ES module
sw.js           service worker, cache name corkd-vN, scope /corkd/
manifest.json   name, icons, start_url and scope /corkd/
icon.png        512x512 app icon (burgundy, wine glass); icon-192.png 192x192
CLAUDE.md       this file
```

Flat folder, no build step, no bundler, no framework. No external CSS/JS (no lucide).

---

## Dev / testing

`index.html?dev=1` on any local server (`npx serve .` or `python3 -m http.server 8080`) loads mock wines and never touches Firestore or auth. All writes are guarded by `if(DEV)`. Do not remove DEV blocks. Service worker only registers when the path starts with `/corkd/`, so it stays off locally.

---

## Architecture

- `S` state object; `render()` draws the active screen (`loading`, `auth`, `cellar`).
- The cellar screen renders its shell once; `refreshCellar()` re-renders only the chips and list (so the search box keeps focus). Firestore snapshots call `refreshCellar()` and `refreshDetail()`.
- Sheets live in `#sheets` (outside `#app`) so live updates never wipe an open sheet. `openSheet(kind, html, bind)`, `setSheetHTML()`, `closeSheets()`. `S.sheet` is `detail | wine | purchase | settings | null`.
- Helpers: `q`, `qAll`, `on`, `esc` (escapes & " ' < >), `cap`, `debounce`, `withTimeout`, `haptic`, `todayStr`, `fmtDate`, `money`, `compressImage`, `makeThumb`, `toast`.
- Main screen: search, type chips (only types in use), toggles Keepers / In stock / Rebuy (Rebuy = keeper with zero stock; it switches off the other two).

---

## Deploy checklist

1. Bump `CACHE` in `sw.js` (`corkd-v1` → `corkd-v2` …) on every deploy that changes `app.js`, `styles.css` or `index.html`.
2. Upload changed files to the repo (Add file → Upload files, same names overwrite).
3. Wait about a minute for Pages, then open the app. The "A new version is available / Reload" toast appears on installed copies.
4. Paths are `/corkd/` in `manifest.json`, `sw.js` (`BASE`) and `app.js` (`BASE`). Change all three together if the repo is ever renamed.

---

## Code delivery conventions (Gary)

- Return only changed functions or blocks, labelled with filename and function (e.g. `app.js → renderCellar()`, `styles.css → .wine-row`).
- Under ~30 lines: find/replace pairs. The "Find" and "Replace" labels go OUTSIDE the code block so each block holds only copyable text. Larger changes: the full updated function.
- Confirm data model changes before writing code.
- Batch related fixes. Identify relevant files first (no code), then change only those; don't re-analyze the whole project.
- Test on desktop with `?dev=1`, then on iPhone.

---

## Not in v1 (ideas, only if asked)

CSV export, spend summary, link to Haul & Paws list, editing or deleting individual purchases, swipe gestures on rows.
