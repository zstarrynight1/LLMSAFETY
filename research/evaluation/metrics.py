"""Tinh Precision/Recall/F1/False Positive Rate, chi phi va do tre cho cac baseline.

Input la ket qua DA LUU (list dict, doc tu JSON/CSV) - module nay KHONG goi LLM va khong
phu thuoc truc tiep vao run_baseline_static.py/run_llm_naive.py/run_pipeline.py, de dung
chung cho ca 4 baseline (RESEARCH_PLAN.md muc 4.1/4.2).

Moi record ky vong co cac field (field nao thieu se duoc bo qua mot cach an toan):
    predicted_vulnerable: bool
    true_vulnerable: bool      (tu label_human - KHONG duoc lay tu label_bandit/label_semgrep
                                 neu dang danh gia chinh bandit/semgrep, tranh circular)
    true_cwe: str | None       (de tinh metric theo CWE category)
    cost_usd: float
    latency_ms: float
"""

import statistics
from collections import defaultdict

DEFAULT_MIN_SAMPLES_PER_CWE = 5


def flatten_prediction_record(record):
    """Chuan hoa 1 record du doan ve dang PHANG ma cac ham trong module nay can:
    {predicted_vulnerable, cost_usd, ...}.

    Cac script trong research/evaluation/ KHONG dung chung 1 schema output:
    - run_baseline_static.py: da phang san (predicted_vulnerable o top-level).
    - run_pipeline.py / run_llm_naive.py: long nhau (predicted.vulnerable, usage.cost_usd).
    Neu khong flatten truoc, r.get("predicted_vulnerable")/r.get("cost_usd") tren record long
    se tra ve None va bi am tham tinh thanh "khong vulnerable" / "chi phi 0" (bool(None) is
    False, "or 0.0" nuot None) - sai lech ket qua nghien cuu ma KHONG co loi/canh bao nao.

    true_vulnerable/true_cwe (ground truth) KHONG nam trong record cua cac script tren - PHAI
    duoc noi rieng tu label_human (xem module docstring), ham nay khong dung toi 2 field do.
    """
    flat = dict(record)
    if "predicted_vulnerable" not in flat:
        predicted = record.get("predicted")
        if isinstance(predicted, dict):
            flat["predicted_vulnerable"] = predicted.get("vulnerable", False)
    if "cost_usd" not in flat:
        usage = record.get("usage")
        if isinstance(usage, dict):
            flat["cost_usd"] = usage.get("cost_usd", 0.0)
    return flat


def confusion_counts(results):
    counts = {"tp": 0, "fp": 0, "fn": 0, "tn": 0}
    for raw in results:
        r = flatten_prediction_record(raw)
        predicted = bool(r.get("predicted_vulnerable"))
        truth = bool(r.get("true_vulnerable"))
        if predicted and truth:
            counts["tp"] += 1
        elif predicted and not truth:
            counts["fp"] += 1
        elif not predicted and truth:
            counts["fn"] += 1
        else:
            counts["tn"] += 1
    return counts


def precision_recall_f1(counts):
    tp, fp, fn = counts["tp"], counts["fp"], counts["fn"]
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    return {"precision": precision, "recall": recall, "f1": f1}


def false_positive_rate(counts):
    fp, tn = counts["fp"], counts["tn"]
    return fp / (fp + tn) if (fp + tn) else 0.0


def compute_binary_metrics(results):
    """Tra ve precision/recall/f1/fpr + confusion counts + so luong mau (n)."""
    counts = confusion_counts(results)
    metrics = precision_recall_f1(counts)
    metrics["fpr"] = false_positive_rate(counts)
    metrics.update(counts)
    metrics["n"] = len(results)
    return metrics


def compute_metrics_by_cwe(results, min_samples=DEFAULT_MIN_SAMPLES_PER_CWE):
    """Tinh metric rieng cho tung CWE category (chi tinh khi du du lieu - tranh metric nhieu)."""
    groups = defaultdict(list)
    for r in results:
        cwe = r.get("true_cwe")
        if cwe:
            groups[cwe].append(r)

    by_cwe = {}
    for cwe, group in groups.items():
        if len(group) < min_samples:
            continue
        by_cwe[cwe] = compute_binary_metrics(group)
    return by_cwe


def compute_cost_per_1000_snippets(results):
    total_cost = sum(flatten_prediction_record(r).get("cost_usd") or 0.0 for r in results)
    n = len(results)
    if n == 0:
        return 0.0
    return total_cost / n * 1000


def compute_latency_stats(results):
    latencies = [
        v for v in (flatten_prediction_record(r).get("latency_ms") for r in results) if v is not None
    ]
    if not latencies:
        return {"mean_ms": 0.0, "median_ms": 0.0, "p95_ms": 0.0}
    sorted_latencies = sorted(latencies)
    p95_index = max(0, int(round(len(sorted_latencies) * 0.95)) - 1)
    return {
        "mean_ms": statistics.mean(latencies),
        "median_ms": statistics.median(latencies),
        "p95_ms": sorted_latencies[p95_index],
    }


def summarize(results, min_samples_per_cwe=DEFAULT_MIN_SAMPLES_PER_CWE):
    """Tong hop day du: binary metrics, metrics theo CWE, chi phi/1000 snippet, do tre."""
    return {
        "overall": compute_binary_metrics(results),
        "by_cwe": compute_metrics_by_cwe(results, min_samples=min_samples_per_cwe),
        "cost_usd_per_1000_snippets": compute_cost_per_1000_snippets(results),
        "latency": compute_latency_stats(results),
    }
