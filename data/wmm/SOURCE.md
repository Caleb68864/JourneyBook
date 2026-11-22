# World Magnetic Model 2025 (WMM2025)

Public domain, from NOAA National Centers for Environmental Information (NCEI).

- Source page: https://www.ncei.noaa.gov/products/world-magnetic-model/wmm-coefficients
- Archive: https://www.ncei.noaa.gov/sites/default/files/2024-12/WMM2025COF.zip
  (SHA-256 `2e76569370d081f2cd7919490218bd094ca9afde347b198eff5621e0af460d03`, fetched 2026-11-22)
- `WMM2025.COF`: the coefficient file from that archive, unchanged. Header `2025.0 WMM-2025 11/13/2024`;
  the archive's README is dated December 17, 2024. Valid 2025.0 to 2030.0.
- `WMM2025_TestValues.txt`: NOAA's published test values from the same archive, unchanged
  (100 points, 2025.0 to 2029.5, with altitude in km, geodetic latitude and longitude).

`packages/atlas-core/src/declination.ts` embeds these coefficients; `declination.test.ts` parses
this `.COF` and fails if the embedded copy differs, and reproduces every test value.
