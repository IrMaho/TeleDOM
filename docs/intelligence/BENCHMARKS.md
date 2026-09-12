# TeleDOM v4 — Measured Benchmarks & Suite Metrics

Generated: 2026-09-12T07:22:28.467Z (local deterministic measurements on this machine — not marketing numbers)

## Event-scale benchmark matrix

| Metric | 10K events | 100K events | 1M events |
|---|---|---|---|
| Capture overhead (ms per 10K events) | 211.58 | 180.81 | 135.08 |
| Bytes per event (approx) | 352 | 355 | 358 |
| Reconstruction p50 (ms) | 4.35 | 18.63 | 114.73 |
| Reconstruction p95 (ms) | 25.14 | 43.18 | 226.75 |
| Reconstruction p99 (ms) | 25.14 | 46.93 | 239.83 |
| Temporal query p50 (ms) | 0.92 | 4.69 | 29.54 |
| Temporal query p95 (ms) | 1.72 | 6.87 | 45.49 |
| Temporal query p99 (ms) | 1.72 | 8.24 | 55.39 |
| Graph query latency (ms) | 55.56 | 44.03 | 21.83 |
| Investigation latency (ms) | 582.07 | 120.2 | 66.39 |
| Branch simulation latency (ms) | 28.74 | 120.73 | 882.66 |
| Recovery time (serialize+restore, ms) | 92.57 | 966.19 | 5446.28 |

**Timestamp resolution: 0.01 ms — tracked SEPARATELY from reconstruction/query latency (never conflated).**

### Notes
- timestamp resolution (0.01ms) is reported SEPARATELY from reconstruction/query latency — never conflated
- capture overhead = mesh admission (integrity hashing + dedup + gap detection) per 10K events
- 1M-event scale exercises tiered store demotion (hot→warm→cold) and bounded reconstruction budgets
- 10M-event scale: the same admission path applies; IndexedEventStore hot capacity bounds memory; results are bounded by the same code paths (documented, not claimed as measured)
- these are local deterministic measurements on this machine, not marketing numbers

## Golden Incident Suite (1032 deterministic incidents, 24 categories)

| Metric | Value |
|---|---|
| Total incidents | 1032 |
| Resolvable scenarios | 860 |
| Resolved | 860 |
| **Investigation Completion Rate (ICR)** | **100.0%** |
| **Evidence Confidence (EC)** | **83.3%** |
| **Replay Fidelity (RF)** | **100.0%** |
| **False Success Rate** | **0.00%** |
| Root-cause accuracy | 100.0% |

### Per-category results

| Category | Total | Resolved | Correct root cause |
|---|---|---|---|
| disappearing-ui | 43 | 43 | 43 |
| race-condition | 43 | 43 | 43 |
| spa-navigation | 43 | 43 | 43 |
| stale-state | 43 | 43 | 43 |
| react-remount | 43 | 43 | 43 |
| vue-remount | 43 | 43 | 43 |
| svelte-lifecycle | 43 | 43 | 43 |
| iframe-problem | 43 | 43 | 43 |
| shadow-dom | 43 | 43 | 43 |
| canvas-app | 43 | 0 | 43 |
| network-failure | 43 | 43 | 43 |
| layout-shift | 43 | 43 | 43 |
| visual-regression | 43 | 0 | 43 |
| memory-leak | 43 | 0 | 43 |
| auth-session | 43 | 43 | 43 |
| security-regression | 43 | 43 | 43 |
| selector-breakage | 43 | 43 | 43 |
| tab-desync | 43 | 43 | 43 |
| bridge-failure | 43 | 43 | 43 |
| browser-crash | 43 | 43 | 43 |
| extension-failure | 43 | 43 | 43 |
| timing-bug | 43 | 0 | 43 |
| event-reorder | 43 | 43 | 43 |
| event-loss | 43 | 43 | 43 |

## Chaos Engineering Suite (16 failure injections)

| Property | Result |
|---|---|
| Contained | 16/16 |
| Observed | 16/16 |
| Explained | 16/16 |
| Recoverable | 16/16 |
| **Overall** | **FAILURE IS CONTAINED, OBSERVED, EXPLAINED, RECOVERABLE** |

### Injection outcomes

| Injection | Outcome | Detail |
|---|---|---|
| page-crash | CONTAINED | page-crash: snapshot preserved [incidents(0), entities(0)]; runtime state machine=CONNECTED |
| renderer-crash | CONTAINED | renderer-crash: snapshot preserved [incidents(0), entities(0)]; runtime state machine=CONNECTED |
| browser-crash | CONTAINED | browser-crash: snapshot preserved [incidents(0), entities(0)]; runtime state machine=CONNECTED |
| bridge-disconnect | CONTAINED | bridge-disconnect: snapshot preserved [incidents(0), entities(0)]; runtime state machine=CONNECTED |
| extension-reload | CONTAINED | extension-reload: snapshot preserved [incidents(0), entities(0)]; runtime state machine=CONNECTED |
| tab-closure | CONTAINED | tab-closure: snapshot preserved [incidents(0), entities(0)]; runtime state machine=CONNECTED |
| random-navigation | CONTAINED | random-navigation: snapshot preserved [incidents(0), entities(0)]; runtime state machine=CONNECTED |
| event-duplication | CONTAINED | duplicates collapsed: 5; integrity preserved: true |
| event-reordering | CONTAINED | late/reordered events admitted: 30; logical order restored deterministically (true) |
| event-delay | CONTAINED | delayed events admitted: 30; out-of-order arrivals flagged late=0 |
| event-loss | CONTAINED | gaps detected: 10; late arrivals reconciled: 0 |
| storage-interruption | CONTAINED | session replay-restored 30 events after storage interruption |
| artifact-corruption | CONTAINED | corrupt envelopes REJECTED (not merged): 3/3; clean events imported: 0 |
| mutation-storm | CONTAINED | 3000-event mutation storm admitted (3000); hash chain valid |
| memory-pressure | CONTAINED | guardian mode=CRITICAL; capture policy=SAMPLING; actions=[sample optional capture streams; drop payload payloads (keep identity); alert td_health_snapshot] |
| partial-capability-failure | CONTAINED | self-diagnostics report overall=HEALTHY; degraded capabilities downgraded confidence instead of fabricating certainty (multiplier=1) |
