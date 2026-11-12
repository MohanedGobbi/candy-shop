# Candy Shop

Register and stock software for a small shop: checkout with barcode scanner,
products, sales history with undo, analytics, French / Arabic. Two PCs share
their data through a Google Sheet (Apps Script web app). Runs on Windows 7 and 10
(Electron 22).

## Install

Download `Candy Shop Setup x.y.z.exe` from the latest
[release](https://github.com/MohanedGobbi/candy-shop/releases/latest) and run it.
Installed copies update themselves from new releases.

## Google Sheet

The two PCs sync through a Google Sheet with a small Apps Script web app.

- Script to paste into the Sheet (Extensions > Apps Script): [app/apps-script/Code.gs](app/apps-script/Code.gs)
- Step-by-step setup (French): [app/apps-script/SETUP.md](app/apps-script/SETUP.md)

The sync link and key are **not** in this repository on purpose: anyone who has
both can read and change the shop's data. They are in each PC's
Paramètres page and in the local install folder's `LISEZ-MOI.txt`.

## Develop

```
cd app
npm install
npm run build:web
npx electron .
```

Tests: `node scripts/smoke-test.cjs`, `undo-test.cjs`, `scanner-buffer-test.mjs`,
`apps-script-views-test.cjs`, `sync-smoke-test.cjs`.

## Release

Push to `main`. GitHub Actions builds the installer and publishes release
`1.0.<run number>`; the apps download it in the background and install it on the
next restart.
