# Adoption Interest Queue (Ticket ENG-22666)

Digital queue for animal shelter floor staff, replacing paper and Excel tracking.
Vanilla JavaScript (ES6+), no framework, no build step.

**Live URL:** _paste your Vercel/Netlify link here_

## Run locally
Open `index.html` in a browser, or run `npx serve .`

## Lint
```bash
npx eslint script.js
```

## Requirement mapping

| Requirement | Where |
|---|---|
| Empty state ("No data found") | `renderQueue()` in `script.js` |
| Loading indicator on slow connections | `.loading` spinner on load, `#saving` indicator on every save |
| Invalid input blocked, fields highlighted red | `validate()` + `showFieldErrors()`, red border plus "Error:" text |
| Failed connection handling | `simulateNetwork()`, error box with Retry, offline banner |
| Accessibility | Labels on every input, `aria-invalid`, `aria-describedby`, live regions, skip link, keyboard focus styles |
| Telemetry simulation | `track()` logs `[Analytics] User interacted with Adoption Interest Queue (...)` |
| XSS sanitization before state | `sanitizeText()` escapes `& < > " ' \`` before anything is stored |
| Monochrome design, 8/16/32px spacing | CSS tokens in `style.css` (one extra token, `--danger`, is used only for errors) |

## Testing the edge cases
- **Empty state:** remove all entries, or search for something that does not exist.
- **Slow connection:** every load and save waits 0.5 to 1.2 seconds on purpose.
- **Failed connection:** tick "QA tool: simulate a failed connection" in the footer, then add or change an entry.
- **Offline:** turn off Wi-Fi or use DevTools > Network > Offline.
- **XSS:** submit `<img src=x onerror=alert(1)>` as a name. It shows as plain text.
- **Invalid form:** submit empty, or use `abc` as the contact.

## Notes
- Data is stored in the browser's `localStorage`, behind a small mock API layer (`api.load` / `api.save`). Replace those two functions with real `fetch` calls when a backend exists.
- Sample entries use fake names and `example.com` emails only.
