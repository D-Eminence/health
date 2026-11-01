# Fonts

The public site's two typefaces, loaded by `app/layout.tsx` through
`next/font/local`. They are committed so the build reads them from here: with
`next/font/google` the build downloaded them from Google Fonts, and that
download intermittently failed the public build in CI.

Each file is, byte for byte, the latin WOFF2 that `next/font/google` downloaded
for this site, so visitors get the same files as before. Each family's
`OFL.txt` is the licence google/fonts publishes beside that family, unmodified.
Both fonts are under the SIL Open Font License 1.1, which requires the licence
to travel with them.

| File | Source | Bytes | sha256 |
|---|---|---|---|
| `forum/forum-latin-400-normal.woff2` | `https://fonts.gstatic.com/s/forum/v19/6aey4Ky-Vb8Ew8IROpI43XnS.woff2` | 13,684 | `678331fb318a613e6f7e4db9e608545b7ab57c192d215882caee23d4d787264d` |
| `forum/OFL.txt` | google/fonts `ofl/forum/OFL.txt` | 4,399 | `1bfe7d2aca99042eabf37079152fef8abdda2c36dad454ae89b858a3cb1078c5` |
| `inter/inter-latin-wght-normal.woff2` | `https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2` | 48,432 | `c940764593d0fe5d596be327ca7558855e018039fb78509aa21921fd3644c3e4` |
| `inter/OFL.txt` | google/fonts `ofl/inter/OFL.txt` | 4,377 | `5b9321a4298cfeb6b34354164a1c3afc3db114569984c502b9b35d988fd58c57` |

- **Font files:** fetched on 1 November 2026 exactly as `next/font/google`
  (Next 16.4.2) fetches them: the stylesheets
  `https://fonts.googleapis.com/css2?family=Forum:wght@400&display=swap` and
  `https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap`,
  requested with its user agent (Chrome 104 on macOS), then the file each names
  for the latin subset. Google Fonts' Forum v19 (font version 1.000, Denis
  Masharov) and Inter v20 (font version 4.001, The Inter Project Authors).
  Google serves this user agent unhinted files. Both faces are preloaded on
  every page, so these are kept over Fontsource's hinted Forum, which is about
  10 KB larger.
- **Licences:** fetched from google/fonts at
  `6157dfaa640ca5738b4d1a7070fe389c3036d7fc` (the commit the EHR fonts'
  licences in `packages/ui/src/ehr/fonts` come from).
- **Reserved names:** Forum's author reserves its name: the copyright notice
  at the top of `forum/OFL.txt` ends `with Reserved Font Name "Forum".` The
  file here is Google Fonts' own latin subset of Forum, committed unmodified,
  the same file Google Fonts serves under that name and this site served
  before. Inter's licence names no Reserved Font Name.
- **Inter:** one variable file (weight axis 100 to 900). Google's stylesheet
  names this same file for all three weights the site uses, and `layout.tsx`
  declares it at 400, 500 and 600 the same way, so other weights resolve
  exactly as before.
- **Subset:** latin only (`U+0000-00FF` and a few punctuation and symbol
  ranges), the subset `layout.tsx` asked Google for and preloaded.
  `next/font/google` also declared, without preloading, Google's other subsets
  for characters outside latin: for Forum latin-ext, cyrillic and cyrillic-ext;
  for Inter latin-ext, cyrillic, cyrillic-ext, greek, greek-ext and vietnamese.
  None of the site's text uses them: the only characters outside latin in the
  public site's source are arrows, ⌘ and ✓, which no Google subset of either
  family covers. A character outside latin, such as the naira sign (₦), would
  show in the fallback face; add that subset's file here if one is ever needed.

`__tests__/selfHostedFonts.test.ts` checks that every committed font file is
listed here with its sha256, is WOFF2, and has its `OFL.txt` beside it,
unchanged, with Forum's reserved name.
