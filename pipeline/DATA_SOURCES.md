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
Do not silently assume 2 m, 10 m, or even 0 m. The cited
[Mazarico et al. (2011) paper](https://doi.org/10.1016/j.icarus.2010.10.030)
studies height-dependent illumination, but that alone does not establish the height
of this 2016 raster release. The [NASA bibliographic record](https://ntrs.nasa.gov/citations/20120010094)
has no downloadable full text. Product-specific confirmation from the producer
or additional authoritative release documentation is still required to close Q2.

**Search status (#57, 2026-11-15):** a further search of the PGDA page, the release
README, the labels, and public abstracts found no product-specific height for this 2016
release. The only "2 m" found
([Gläser et al.](https://ntrs.nasa.gov/api/citations/20170007365/downloads/20170007365.pdf))
describes a different 20 m DTM product and must not be transferred to these rasters.
The Mazarico et al. (2011) full text and the Barker et al. papers were **not** read.
Producer confirmation has not been obtained.

**Proposed interim disposition (pending team approval; not yet agreed):** the observer
height of PGDA product 69 is recorded as **unknown**. Until it is confirmed, #20 may
compare against these rasters only as an any-disk-visible, height-unspecified
reference. It must not report "height-matched" agreement, and must not publish a PGDA
accuracy figure (including the ±5 percentage-point criterion) in `validation.json`.

This does not block fetching or DEM work. It **does block claiming a height-matched
PGDA validation** in #20. The spec's mean-Sun-fraction and Earth-center comparison
also differs from these label definitions. #20 must reconcile the validation
definitions with the team before asserting the ±5 percentage-point criterion.
T3 does not change the data contract or invent a validation accuracy number.

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
