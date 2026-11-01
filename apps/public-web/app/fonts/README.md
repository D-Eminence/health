# Fonts

The public site's two typefaces, loaded by `app/layout.tsx` through
`next/font/local`. They are committed so the build reads them from here: with
`next/font/google` the build downloaded them from Google Fonts, and that
download intermittently failed the public build in CI.

Each file is the latin-subset WOFF2 exactly as published in the npm package
below (unmodified; no subsetting or conversion here), and each family's
`LICENSE` is that package's licence file, also unmodified. Both fonts are under
the SIL Open Font License 1.1, which requires the licence to travel with them.
Neither licence names a Reserved Font Name.

| File | Package | File in the package | sha256 |
|---|---|---|---|
| `forum/forum-latin-400-normal.woff2` | `@fontsource/forum@5.3.0` | `files/forum-latin-400-normal.woff2` | `21eb0ef1c5f416bd7837e9bcf5c0ba1b026a9d56e5aed213871957ff442cae1d` |
| `forum/LICENSE` | `@fontsource/forum@5.3.0` | `LICENSE` | `6fb50d8719d64601e311e535f6bae46f842fbc0d231c0db1827e65015d2ad137` |
| `inter/inter-latin-wght-normal.woff2` | `@fontsource-variable/inter@5.3.0` | `files/inter-latin-wght-normal.woff2` | `3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62` |
| `inter/LICENSE` | `@fontsource-variable/inter@5.3.0` | `LICENSE` | `3b0a5fca3d17942cde889069889dedbbbd075e9b599968c82a95f4d944e9b345` |

- **Packages:** fetched with `npm pack` on 1 November 2026. Their registry
  shasums: `@fontsource/forum@5.3.0` `cd1fadc512ce7a6dc9bcd3715c33649d019c3541`,
  `@fontsource-variable/inter@5.3.0` `351dd1e02dab63a6cf66d57ec36dcfd10c07f07b`
  (both from fontsource/font-files at `02b28c06b126c852a5b966b44aef777ca923f6f6`).
  They are not dependencies of this repository.
- **Upstream versions:** Google Fonts' Forum v19 (font version 1.000, Denis
  Masharov) and Inter v20 (font version 4.001, The Inter Project Authors), the
  same versions `next/font/google` downloaded for this site.
- **Forum:** weight 400, the only weight it has. Compared on 1 November 2026
  with the file Google Fonts served the build: the same characters, outlines,
  advance widths and metrics, and the same cmap, GPOS, hmtx, name and OS/2
  tables. This copy keeps its TrueType hinting (instructions in glyf, and the
  cvt, fpgm, prep, hdmx and VDMX tables), which Google strips for the browser
  the build presented itself as, so it is about 10 KB larger.
- **Inter:** one variable file (weight axis 100 to 900; optical size fixed at
  its default, 14). Compared on 1 November 2026 with the file Google Fonts
  served the build for all three weights the site uses: every table is byte
  for byte the same, and this copy adds one, a small `prep` hinting table.
  `layout.tsx` declares it at 400, 500 and 600, as Google's stylesheet did, so
  other weights resolve exactly as before. One 48 KB file instead of three
  static files of about 24 KB each.
- **Subset:** latin only (`U+0000-00FF` and a few punctuation and symbol
  ranges), the subset `layout.tsx` asked Google for and preloaded.
  `next/font/google` also declared, without preloading, Google's other subsets
  (latin-ext, cyrillic, greek, vietnamese) for characters outside latin. None
  of the site's text uses them: the only characters outside latin in the
  public site's source are arrows, ⌘ and ✓, which no Google subset of either
  family covers. A character outside latin, such as the naira sign (₦), would
  show in the fallback face; add that subset's file here if one is ever needed.

`__tests__/selfHostedFonts.test.ts` checks that every committed font file is
listed here with its sha256, is WOFF2, and has its licence beside it.
