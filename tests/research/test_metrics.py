import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "research" / "evaluation"))

from metrics import (  # noqa: E402
    compute_binary_metrics,
    compute_cost_per_1000_snippets,
    compute_latency_stats,
    compute_metrics_by_cwe,
    confusion_counts,
    false_positive_rate,
    precision_recall_f1,
    summarize,
)

# 10 mau voi ket qua biet truoc: 4 TP, 1 FP, 1 FN, 4 TN
KNOWN_RESULTS = [
    {"predicted_vulnerable": True, "true_vulnerable": True, "true_cwe": "CWE-89"},
    {"predicted_vulnerable": True, "true_vulnerable": True, "true_cwe": "CWE-89"},
    {"predicted_vulnerable": True, "true_vulnerable": True, "true_cwe": "CWE-79"},
    {"predicted_vulnerable": True, "true_vulnerable": True, "true_cwe": "CWE-79"},
    {"predicted_vulnerable": True, "true_vulnerable": False, "true_cwe": None},  # FP
    {"predicted_vulnerable": False, "true_vulnerable": True, "true_cwe": "CWE-89"},  # FN
    {"predicted_vulnerable": False, "true_vulnerable": False, "true_cwe": None},
    {"predicted_vulnerable": False, "true_vulnerable": False, "true_cwe": None},
    {"predicted_vulnerable": False, "true_vulnerable": False, "true_cwe": None},
    {"predicted_vulnerable": False, "true_vulnerable": False, "true_cwe": None},
]


def test_confusion_counts_matches_known_tp_fp_fn_tn():
    counts = confusion_counts(KNOWN_RESULTS)
    assert counts == {"tp": 4, "fp": 1, "fn": 1, "tn": 4}


def test_precision_recall_f1_known_values():
    counts = {"tp": 4, "fp": 1, "fn": 1, "tn": 4}
    metrics = precision_recall_f1(counts)
    assert metrics["precision"] == pytest.approx(0.8)  # 4/5
    assert metrics["recall"] == pytest.approx(0.8)  # 4/5
    assert metrics["f1"] == pytest.approx(0.8)


def test_precision_recall_f1_handles_zero_division_gracefully():
    counts = {"tp": 0, "fp": 0, "fn": 0, "tn": 10}
    metrics = precision_recall_f1(counts)
    assert metrics == {"precision": 0.0, "recall": 0.0, "f1": 0.0}


def test_false_positive_rate_known_value():
    counts = {"tp": 4, "fp": 1, "fn": 1, "tn": 4}
    assert false_positive_rate(counts) == pytest.approx(0.2)  # 1/5


def test_compute_binary_metrics_includes_n_and_counts():
    metrics = compute_binary_metrics(KNOWN_RESULTS)
    assert metrics["n"] == 10
    assert metrics["tp"] == 4
    assert metrics["precision"] == pytest.approx(0.8)
    assert metrics["fpr"] == pytest.approx(0.2)


def test_compute_metrics_by_cwe_respects_min_samples_threshold_precisely():
    by_cwe_strict = compute_metrics_by_cwe(KNOWN_RESULTS, min_samples=5)
    assert by_cwe_strict == {}  # khong category nao co >= 5 mau

    by_cwe_loose = compute_metrics_by_cwe(KNOWN_RESULTS, min_samples=1)
    assert set(by_cwe_loose.keys()) == {"CWE-89", "CWE-79"}
    assert by_cwe_loose["CWE-89"]["n"] == 3
    assert by_cwe_loose["CWE-79"]["n"] == 2


def test_compute_cost_per_1000_snippets():
    results = [{"cost_usd": 0.001} for _ in range(10)]
    cost = compute_cost_per_1000_snippets(results)
    assert cost == pytest.approx(1.0)  # 0.01 total / 10 * 1000


def test_compute_cost_per_1000_snippets_handles_empty_list():
    assert compute_cost_per_1000_snippets([]) == 0.0


def test_compute_latency_stats_known_values():
    results = [{"latency_ms": v} for v in [100, 200, 300, 400, 500]]
    stats = compute_latency_stats(results)
    assert stats["mean_ms"] == pytest.approx(300)
    assert stats["median_ms"] == pytest.approx(300)


def test_compute_latency_stats_handles_no_latency_data():
    assert compute_latency_stats([]) == {"mean_ms": 0.0, "median_ms": 0.0, "p95_ms": 0.0}


def test_summarize_combines_all_metrics():
    summary = summarize(KNOWN_RESULTS, min_samples_per_cwe=1)
    assert summary["overall"]["n"] == 10
    assert "CWE-89" in summary["by_cwe"]
    assert "cost_usd_per_1000_snippets" in summary
    assert "latency" in summary
