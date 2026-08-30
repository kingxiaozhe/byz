# Local Diagnostics Foundation — Built CLI Performance

- Date: 2026-08-30
- Environment: Node v24.14.0
- Command: isolated `HOME` and `BYZ_DIAGNOSTICS_HOME`, network-blocking preload, built `node packages/byz/dist/cli.js --version`
- Sampling: 5 warmups, 30 measured runs, nearest-rank p95
- Baseline p95: 201.88 ms
- Built diagnostics p95: 206.43 ms
- Delta: +4.55 ms
- Budget: ≤20 ms
- Result: PASS
- Built median: 200.77 ms

The measured command preserved stdout (`0.1.10`), empty stderr, and exit code 0 for every sample.
