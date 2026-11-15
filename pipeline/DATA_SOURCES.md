# T3: cached science inputs

Run from `pipeline/`: `uv sync`, then `uv run lunarnav fetch`.
Raw files, labels, SHA-256 receipts, and `sources.json` stay in the gitignored
`pipeline/data/raw/`. No network is needed on a second run with an intact cache.
The cache checks both size and SHA-256; missing/corrupt entries are downloaded
again, with three attempts and atomic replacement. Interrupted `.part` files are
never accepted as data. SHA-256 receipts detect local corruption; they are not
publisher-signed checksums. First downloads require trusted HTTPS.

## SPICE kernels

The fetch catalog pins these exact URLs under `raw/kernels/`:

| Purpose | URL |
| --- | --- |
| Leap seconds | https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls |
| Planetary positions | https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp |
| Lunar orientation | https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/moon_pa_de440_200625.bpc |
| Lunar frames | https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/moon_de440_250416.tf |
| Body constants | https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc |

The [frame kernel](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/moon_de440_250416.tf)
explicitly pairs with `moon_pa_de440_200625.bpc`. Its `MOON_ME` alias is
`MOON_ME_DE440_ME421`, aligned with the DEMs' DE421 mean-Earth frame. Use this
pair together; do not substitute `IAU_MOON` or `MOON_PA`. Downstream ephemeris
generation (#6) loads the kernels and verifies time coverage; T3 only fetches them.

## LOLA terrain: Open Question 4 resolved

These are original LOLA GDR V2.0 PDS3 products, not the newer adjusted PGDA DEMs.
Both have detached ASCII labels and little-endian signed int16 IMG files.

| Local stem under `raw/dem/` | Resolution | Latitude cap | Shape | IMG bytes |
| --- | --- | --- | --- | --- |
| `LDEM_80S_80M` | 80 m/px | 80–90°S | 7600 × 7600 | 115,520,000 |
| `LDEM_75S_240M` | 240 m/px | 75–90°S | 3812 × 3812 | 29,062,688 |

Exact files:

- https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/LDEM_80S_80M.IMG
- https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/LDEM_80S_80M.LBL
- https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/LDEM_75S_240M.IMG
- https://imbrium.mit.edu/DATA/LOLA_GDR/POLAR/IMG/LDEM_75S_240M.LBL

Each label defines **height above the 1737.4 km sphere = DN × 0.5 meters**.
`OFFSET=1737400` is only added for planetary radius, never for surface height.
Coordinates are planetocentric, east-positive longitude, DE421 mean Earth/polar
axis, spherical south polar stereographic, true scale at −90°, central longitude
0°. X points toward 90°E and Y toward 0°E. For latitude φ and longitude λ:
`rho = 2 R tan((90° + φ)/2)`, `x = rho sin λ`, `y = rho cos λ`.
The inverse uses `φ = −90° + 2 atan(rho/(2R))`, `λ = atan2(x,y)`.

Pixel-center registration uses zero-based column = `x / cell + SAMPLE_PROJECTION_OFFSET`
and row = `LINE_PROJECTION_OFFSET − y / cell`. Offsets are 3799.5 (near) and
1905.5 (far): the pole lies between four pixels. `DemStack.height_m` uses bilinear
interpolation, favors the near field, and falls back to far field for uncovered
or nodata samples. Outside both circular latitude caps returns NaN, never a
fabricated zero-meter height. NaN must be treated as missing terrain by #8.
The sampler supports broadcastable NumPy arrays and reads rasters with read-only
memory maps, avoiding a full float64 copy of the DEM. No new dependencies.

```python
from lunarnav.dem import DemStack, lat_lon_to_xy_km

terrain = DemStack()
pole_height_m = terrain.height_m(0, 0)
x_km, y_km = lat_lon_to_xy_km(-89.45, -137.3)
ridge_height_m = terrain.height_m(x_km, y_km)
```

## PGDA product 69

[NASA PGDA product 69](https://pgda.gsfc.nasa.gov/products/69) links these exact
original IMG rasters. We use the 120 m/px 75–90°S products (7624 × 7624,
116,250,752 bytes each), stored under `raw/pgda/`:

- https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/AVGVISIB_75S_120M_201608.IMG
- https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/AVGVISIB_75S_120M_201608.LBL
- https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/AVGVISIB_75S_120M_201608_EARTH.IMG
- https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/AVGVISIB_75S_120M_201608_EARTH.LBL

Both labels specify a scale of 0.00004 and offset 0: `fraction = DN × 0.00004`,
`percent = DN × 0.004`. Do not treat the stored int16 as percent or a mean solar
flux. Both use the same projection as LOLA, with offsets 3811.5. `PdsRaster.sample`
can read these layers as fractions; PNG resampling belongs to #25.

### Visibility definitions and unresolved Open Question 2

Tracked in [follow-up issue #57](https://github.com/O-n-The-Moon/Lunar-Landing-Site-Navigator/issues/57),
a prerequisite for PGDA validation #20. The issue owner authorized separating this
scientific confirmation from T3's fetch/sampler deliverables. The uncertainty
remains explicit; this scope clarification does not change validation criteria.

The selected **labels** define the fraction of timesteps when **any part of the
Sun/Earth disk** is visible. Product 69 describes hourly sampling over ~18.6 years
and specifically cautions that any-Earth-disk visibility can be optimistic for
ground-station communications. Observation START/STOP_TIME in the labels describes
the input LOLA observations, not the illumination simulation interval.

**Observer height: not stated in the product page, either selected label, or the
[release README](https://imbrium.mit.edu/EXTRAS/ILLUMINATION/README_ILLUMINATION_2016.TXT).**
The fetch command also caches that README under `raw/pgda/`.
Do not silently assume any height; 0 m is used below only as a labelled working
assumption (see the Disposition). The cited
[Mazarico et al. (2011) paper](https://doi.org/10.1016/j.icarus.2010.10.030)
studies height-dependent illumination, but that alone does not establish the height
of this 2016 raster release. The [NASA bibliographic record](https://ntrs.nasa.gov/citations/20120010094)
has no downloadable full text. Product-specific confirmation from the producer
would be required to *confirm* the height; the team chose to proceed on the labelled
assumption instead (see the Disposition).

**Search status (#57, 2026-11-15):** a further search of the PGDA page, the release
README, the labels, and public abstracts found no product-specific height for this 2016
release. The [PDS GDRVIS product description](https://ode.rsl.wustl.edu/mars/pagehelp/Content/Missions_Instruments/LRO/LOLA/GDR/GDRVIS.htm)
(the archive page for this product family, including the 2016 `AVGVISIB_*_201608`
names) was also read in full and states no height. Heights that appear in other
sources describe **different products** and must not be transferred to these rasters:

| Source | Height stated | Why it does not apply to product 69 |
|---|---|---|
| [Gläser et al.](https://ntrs.nasa.gov/api/citations/20170007365/downloads/20170007365.pdf) | 2 m (lander panel height) | different product: 20 m/px LOLA DTMs, 20-year average |
| [Bryant (2009), JPL IPN 42-176](https://ipnpr.jpl.nasa.gov/progress_report/42-176/176C.pdf) | 2 m "tower" | Goldstone radar DEM, 2009–2028 averages |
| [Barker et al. (2021)](https://ntrs.nasa.gov/api/citations/20205009660/downloads/Mike%20Barker_%20Paper_%20Improved%20Lola.pdf) | 1 m and 5 m | new 5 m/px LDEMs of four sites, Jan 2024–Jan 2026 |

Barker et al. does show why the unknown matters. At their Site 1 the 1st percentile
of average illumination is about 67–71% at Δz = 1 m and about 83–89% at Δz = 5 m
(Table 2, case A: percentiles computed after averaging each region of interest;
Figs. 14 and 16 show both heights). Different DEM and dates, so this is a
sensitivity illustration, not a correction factor for product 69. They also state that their
horizon method follows Mazarico et al. (2011), but give no height for the 2016 rasters.

**Mazarico et al. (2011) full text was read** (Icarus 211, 1066–1081, page numbers
below are the journal's). It documents the method behind the **2010, 240 m** maps, not
the 2016 rasters, but it is the best primary evidence available:

- **Height:** the average maps (Fig. 6) "were obtained at **surface level**" (§5.2,
  p. 1079). A 10 m height is a separate sensitivity (Table 3, Figs. 13–14).
  Earth visibility (Fig. 7) reuses "the same elevation maps ... only the radius and
  location of the source need to be changed" (§3.4, p. 1072), so surface level is
  implied there but not stated.
- **Earth definition:** "we consider the Earth visible if any fraction of the disc is"
  (§3.4). This matches the 2016 label definition.
- **Sun products:** three maps are made: Sun *visibility* (boolean, any part of the disc
  visible), Sun *illumination* (mean of the visible disc-area fraction) and incident
  flux (§2.2, §3.3). Fig. 6 is **illumination** (disc-area fraction). The 2016 Sun
  label describes the any-part-visible quantity, i.e. the *visibility* type. Our planned
  comparator (mean visible-disc fraction) is the *illumination* type, so the two
  differ by definition (worked example under "Height matters" below).
- **Timestep and span:** 6 h steps over four precession cycles, 1970–2044 (§3.3).
  The PGDA product page describes the 2016 release as hourly over ~18.6 years, so the
  release parameters differ from the paper's.
- **Worked example (240 m DEM, Table 3, p. 1077):** at SP-01 (222.69°E, 89.45°S)
  illumination / visibility are 89.01 % / 92.66 % at surface level and
  93.10 % / 95.83 % at 10 m. The illumination-vs-visibility gap (3.65 pp at the
  surface) and the height effect (4.09 pp / 3.17 pp) are separate effects, each of the
  same order as the ±5 pp criterion. This illustrates sensitivity for the 2010 maps; it
  is not a check of our pipeline.

**What this does not settle:** the paper does not mention the 2016 120 m rasters.
"Surface level" for the 2010 method is strong evidence, not confirmation, for the
2016 release, so Q2 stays **open** pending the producers. Web-search summaries that
gave "10 m" for the base maps are contradicted by the paper (10 m is the sensitivity
case). Producer confirmation has not been obtained.

**Disposition for #20 (agreed with the team, 2026-11-15):** the observer height of PGDA product 69 stays recorded as
**not documented**; the working assumption is **surface level (0 m)**, from
Mazarico et al. (2011) for the 2010 maps, and it is not confirmed for the 2016 release.
#20 should:

1. **Compare like with like (validation only).** Use the PGDA definition: a body counts
   as visible when any part of its disc clears the terrain horizon mask (Sun elevation
   + nominal 0.265°; Earth elevation + its angular radius, about 0.95°; both values as
   used in Bryant 2009). The app's own
   metrics (mean disc fraction, Earth centre plus margin) are unchanged.
2. **Run at 0 m** as the primary comparison, with the app's own 2 m and 10 m site
   heights (`SPEC-data-pipeline.md` §2) as sensitivity runs, not as assumptions about
   PGDA. A consistent best match at 0 m supports the assumption; a mixed
   result keeps the claim conditional.
3. **Use an hourly timestep** over about 18.6 years, as the PGDA release describes.
   Compute the Sun and Earth vectors directly from the pinned SPICE kernels, not from the
   shipped `ephemeris.bin` (2026–2032 only). Coverage checked with spiceypy: `de440s.bsp`
   1849–2150, `moon_pa_de440_200625.bpc` 1550–2650.
4. **Match the pixel carefully:** bilinear sample at the site, plus the range over
   ±1–2 pixels at rim sites (our near-field DEM is 80 m, the raster 120 m).
5. **Publish the ±5 percentage-point result only with a conditional label:** "agreement
   with PGDA under the any-disc definition, surface level assumed". Never present it as
   accuracy against truth or as "height-matched". Report per-site rows, with an
   explanation for each outlier.

**Spec status.** The PGDA bullet in `SPEC-data-pipeline.md` §5 is aligned to this
disposition in the #57 PR. `SPEC.md` is **not** changed here: Success Criterion 2
(mean disc fraction / Earth centre) and Open Question 2 (which says the height decides
"which of our heights (2 m / 10 m) to compare against") still carry the old wording and
need an update by the spec owner.

**Q2 status:** dispositioned, **not confirmed**. Revisit it, and consider asking the
producers, if the 0 / 2 / 10 m comparison in #20 is inconclusive.

This does not block fetching or DEM work. T3 does not change the data contract or
invent a validation accuracy number.

## Verification and environment

Run `uv run pytest tests/test_dem.py` after fetching to include the real-data check.
Without raw data (CI), only the explicitly marked real-data test is skipped;
synthetic projection, interpolation, precedence, nodata, and cache-corruption tests
always run without network. Full pipeline checks:

```sh
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

For a Python runtime that cannot access macOS CA roots, export the public trusted
certificates and set `SSL_CERT_FILE` for the fetch command. Keep TLS verification
enabled; do not use an unverified SSL context. This is an environment fix, not a
new package dependency or a change to trust policy.

Initial local verification (2026-11-14): independently decoded center DEM samples
2598, 2571, 2596, 2564 give pole height **1291.125 m**; bilinear height at the
connecting-ridge reference coordinate (−89.45°, −137.3°) is **1954.500 m**. These
are reproducibility checks for the pinned files, not surveyed site heights or
accuracy estimates. The 120 m PGDA rasters give pole fractions 0.24591 (Sun) and
0.27180 (Earth).

Citation: Mazarico, E., Neumann, G. A., Smith, D. E., Zuber, M. T., and Torrence,
M. H. (2011), *Illumination conditions of the lunar polar regions using LOLA
topography*, Icarus 211(2), 1066–1081, doi:10.1016/j.icarus.2010.10.030.
