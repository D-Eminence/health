# Fonts

Both fonts are the unmodified upstream variable fonts from
[google/fonts](https://github.com/google/fonts), converted losslessly to WOFF2
(no subsetting, no instancing), because the launch build check accepts only
`.woff` and `.woff2` font assets.

| File | Upstream file | Upstream sha256 | Served as (sha256) |
|---|---|---|---|
| `playfair-display.woff2` | `ofl/playfairdisplay/PlayfairDisplay[wght].ttf` | `c40f2293766a503bc70cce9e512ef844a4ccb7cbcde792fe2ea31d191917d8d6` | `4297e9ec39f1b8157623d048fb99eab03c90e482669599e8fc662ee178994c49` |
| `geist.woff2` | `ofl/geist/Geist[wght].ttf` | `73894e0448cae90a92b6c2f8732b7bb9acb7b94c418bff559dad4a18e1de9659` | `2ffebe993e969069a9789d15164b7715d42491b5835516c5e3b935d5f81b05f1` |

- **Source commit:** both files, and their licences, were fetched from google/fonts
  at `6157dfaa640ca5738b4d1a7070fe389c3036d7fc` (the head of `main` on
  30 October 2026).
- **Licences:** `OFL-PlayfairDisplay.txt` and `OFL-Geist.txt` are the `OFL.txt`
  files beside each font at that commit. Playfair Display reserves its name;
  these files are not Modified Versions, so the name stays usable (OFL FAQ 2.2).
- **Conversion:** fontTools 4.68.0 with Brotli 1.2.1,
  `python -c "from fontTools.ttLib import woff2; woff2.compress('in.ttf','out.woff2')"`.
  Decompressed again, every table is byte for byte the upstream table, except
  what the WOFF2 format itself requires: `head` gains flag bit 11 ("converted
  losslessly") and a new checksum adjustment, and Playfair's empty 8-byte `DSIG`
  stub is dropped. The name tables keep their copyright and licence records.
  `apps/patient-web/src/__tests__/ehr-ui/EhrUiFonts.test.ts` checks all of
  this against the upstream tables.
- **Weights:** Playfair Display 400 to 900, Geist 100 to 900, as their `fvar`
  axes say and as `ehr.css` declares them.
