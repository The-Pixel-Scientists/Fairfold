# Changelog

## 0.1.0 (unreleased)

Planned tag: `360-converter-v0.1.0`.

- Convert a CSV of grants to organisations, laid out as `template.csv`, into
  a 360Giving JSON file, built and checked with the 360Giving export's own
  schema and identifier rules.
- Refuse grants to individuals, unknown columns and more than 50,000 grants.
  Any problem stops the run, lists every problem by row and column, and
  writes no file.
- No network calls, telemetry, cache or settings file.
