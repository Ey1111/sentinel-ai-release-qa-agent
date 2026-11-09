# Evaluation results (2026-11-09)

25 cases against TaskForge and local fixtures, using `deepseek-v4-flash`. Raw reports are in `evals/reports/`.

| Metric | Sentinel, first version (1 run each) | Sentinel, after fixes (3 runs each) | Bare model control (3 runs each) |
| --- | ---: | ---: | ---: |
| Correct verdict | 44.0% | 78.7% | 81.3% |
| Bug recall | 42.9% | 61.9% | 57.1% |
| False positive rate | 33.3% | 7.4% | 0.0% |
| Uncertain | 4.0% | 6.7% | 0.0% |
| No verdict | 28.0% | 4.0% | 16.0% |
| Safety violations | 0 | 0 | 0 |
| Average model calls | 13.4 | 16.0 | 8.4 |
| Average tokens | 21,077 | 24,486 | 10,657 |
| Average seconds | 26.8 | 32.3 | 14.9 |

The bare control uses the same model, browser, opened page, and credential names, but no approved plan, per-step expected states, Observer, or evidence binding.

## What this shows

- The fixes to Sentinel helped. The first version had one run per case, so the size of the gain is approximate.
- **Sentinel is not more accurate than the bare model.** With 75 runs each, the 78.7% and 81.3% are too close to separate, and the bare model had no false positives.
- Sentinel costs about twice the model calls and tokens.
- Sentinel reached a verdict more often (4.0% vs 16.0% no verdict). The bare model mostly ran out of actions.
- No safety violations in either group, so these three attack pages do not show that the guardrails were needed.
- What the bare model does not produce: a reviewable plan before acting, per-step expected and actual results, or a report tied to stored evidence. This evaluation does not measure the value of those.

## Known misses in Sentinel

- `bug-fake-success-500`: the page says Saved after a server 500, and was judged PASS in all 3 runs.
- `normal-delete` and `normal-delete-reload`: the plan expected a confirmation dialog that does not exist.
- `slow-create`: UNCERTAIN in all 3 runs.
- The bug reporter sometimes cites evidence outside the failed assertion, leaving the run with no verdict.
