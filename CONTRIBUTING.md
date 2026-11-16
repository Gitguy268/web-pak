# Contributing

Thanks for helping with web-pak.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting a bug or asking for a feature

Open an [issue](https://github.com/Gitguy268/web-pak/issues/new/choose) and use the template. Say what you did, the archive format and which program made it, your browser and OS, and any error shown in the job list.

Never attach an archive with private files. A small archive made just to show the problem is ideal.

Report security problems privately: see [SECURITY.md](SECURITY.md).

## Making a change

1. Fork the repository and create a branch from `main`.
2. Install [Node.js](https://nodejs.org) 22 or newer, then:

   ```sh
   npm ci
   npm run dev          # http://localhost:5193 with live reload
   ```

3. Make your change. Keep commits small, each with a clear message.
4. Run the checks below, run `npm run build` and commit the rebuilt `app/` folder with your change, and update the README if behaviour changed.
5. Open a pull request and fill in the template.

## Checks

```sh
npm run typecheck
npm test                         # engine tests in Node (Vitest)
npx playwright install chromium
npm run e2e                      # the built app in a real browser
npm run check-build              # app/ matches the sources
```

The engine tests make and extract every format, check passwords and age keys, split volumes, damaged archives, zip-slip paths and old zip name encodings. The end-to-end test drops files into the built app, makes an encrypted 7z, opens it, previews a file and extracts it again.

## Layout

| Path | What it does |
|---|---|
| `src/engine/` | formats, 7-Zip wrapper, codecs, age, checksums, names; the only code that touches archives (runs in Node and in the worker) |
| `src/worker.ts`, `src/engine-client.ts` | one Web Worker per job, a queue of at most two at a time, cancel by terminating |
| `src/main.ts` | the views, drag and drop, dialogs, job dock and keyboard shortcuts |
| `src/preview.ts`, `src/save.ts` | previews inside archives, and saving to a folder or as downloads |
| `public/` | icons, the web app manifest (file handlers, share target) and the service worker |
| `app/` | the built app, committed so GitHub Pages and `start.command` need no build step |

New dependencies need a licence that fits MIT and a line in NOTICE. 7-Zip (LGPL-2.1 with the unRAR restriction) is the one exception: it ships unchanged as its own files in `public/vendor/7z-wasm/` (copied from npm by `npm run build`, checked by `npm run check-build`) and is loaded at run time, never bundled.
