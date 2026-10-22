"""Statistical primitives used by the pre-registered analysis (PLAN 3, 9.2).

- Sign-flip permutation tests on paired drift-level differences: exact enumeration if
  n <= 20, else Monte Carlo with B flips and p = (1 + #{T* >= T}) / (1 + B).
- BCa bootstrap intervals over drifts (jackknife acceleration).
- Exact binomial critical values, sizes and power (H1).
- Wilson and Clopper-Pearson intervals; mid-p McNemar; Holm step-down.
"""

from __future__ import annotations

import math
from typing import Callable, Mapping, Sequence

import numpy as np
from scipy.stats import binom, binomtest, norm

EXACT_MAX_N = 20
DEFAULT_FLIPS = 200_000
DEFAULT_BOOT = 10_000
_TOL = 1e-12


# ----------------------------------------------------------------------------- sign flip
def _sign_matrix_exact(n: int, start: int, stop: int) -> np.ndarray:
    codes = np.arange(start, stop, dtype=np.int64)[:, None]
    bits = (codes >> np.arange(n, dtype=np.int64)[None, :]) & 1
    return (bits * 2 - 1).astype(np.float64)


def _count(means: np.ndarray, obs: float, alternative: str) -> int:
    tol = _TOL * max(1.0, abs(obs))
    if alternative == "two-sided":
        return int(np.count_nonzero(np.abs(means) >= abs(obs) - tol))
    if alternative == "greater":
        return int(np.count_nonzero(means >= obs - tol))
    if alternative == "less":
        return int(np.count_nonzero(means <= obs + tol))
    raise ValueError(f"alternative must be two-sided, greater or less: {alternative}")


def sign_flip_p(
    x: Sequence[float],
    alternative: str = "two-sided",
    flips: int = DEFAULT_FLIPS,
    seed: int = 0,
    exact_max_n: int = EXACT_MAX_N,
    shift: float = 0.0,
) -> dict:
    """Sign-flip test of H0: the distribution of (x + shift) is symmetric about 0.

    Statistic: the mean. `greater` rejects for large means. Returns {p, method, flips, n, mean}.
    """
    v = np.asarray(x, dtype=np.float64) + shift
    n = v.size
    if n == 0:
        return {"p": float("nan"), "method": "none", "flips": 0, "n": 0, "mean": float("nan")}
    obs = float(v.mean())
    if n <= exact_max_n:
        total = 1 << n
        count = 0
        chunk = 1 << 16
        for s in range(0, total, chunk):
            signs = _sign_matrix_exact(n, s, min(total, s + chunk))
            count += _count(signs @ v / n, obs, alternative)
        return {"p": count / total, "method": "exact", "flips": total, "n": n, "mean": obs}
    rng = np.random.default_rng(seed)
    count = 0
    done = 0
    chunk = 10_000
    while done < flips:
        k = min(chunk, flips - done)
        signs = rng.integers(0, 2, size=(k, n), dtype=np.int8).astype(np.float64) * 2 - 1
        count += _count(signs @ v / n, obs, alternative)
        done += k
    return {"p": (1 + count) / (1 + flips), "method": "monte-carlo", "flips": flips, "n": n, "mean": obs}


def sign_flip_p_batch(
    X: np.ndarray, alternative: str, flips: int, rng: np.random.Generator, shift: float = 0.0
) -> np.ndarray:
    """Monte Carlo sign-flip p-values for every row of X (datasets x drifts), one fresh sign
    matrix per call. Used by the simulations only (B is smaller than in the real analysis; the
    (1 + count) / (1 + B) p-value keeps every test valid)."""
    V = np.asarray(X, dtype=np.float64) + shift
    n = V.shape[1]
    signs = rng.integers(0, 2, size=(flips, n), dtype=np.int8).astype(np.float64) * 2 - 1
    obs = V.mean(axis=1)
    means = V @ signs.T / n  # datasets x flips
    tol = _TOL * np.maximum(1.0, np.abs(obs))[:, None]
    if alternative == "two-sided":
        c = (np.abs(means) >= np.abs(obs)[:, None] - tol).sum(axis=1)
    elif alternative == "greater":
        c = (means >= obs[:, None] - tol).sum(axis=1)
    else:
        raise ValueError(alternative)
    return (1 + c) / (1 + flips)


def bootstrap_t_ni_p(x: Sequence[float], delta: float, boot: int, rng: np.random.Generator) -> float:
    """Studentized bootstrap-t p-value over drifts for H0: mean(d) <= -delta (one-sided).

    The only pre-declared fallback for the NI component (PLAN 9.1 iii).
    """
    v = np.asarray(x, dtype=np.float64)
    n = v.size
    m = v.mean()
    se = v.std(ddof=1) / math.sqrt(n)
    if se == 0:
        return 0.0 if m > -delta else 1.0
    t = (m + delta) / se
    idx = rng.integers(0, n, size=(boot, n))
    bs = v[idx]
    bm = bs.mean(axis=1)
    bse = bs.std(axis=1, ddof=1) / math.sqrt(n)
    ok = bse > 0
    tstar = (bm[ok] - m) / bse[ok]
    return float((1 + np.count_nonzero(tstar >= t)) / (1 + tstar.size))


# ----------------------------------------------------------------------------- bootstrap
def bca_ci(
    x: Sequence[float],
    conf: float = 0.95,
    boot: int = DEFAULT_BOOT,
    seed: int = 0,
    stat: Callable[[np.ndarray], float] | None = None,
) -> tuple[float, float]:
    """Two-sided BCa interval for a statistic of i.i.d. drift-level values (default: mean)."""
    v = np.asarray(x, dtype=np.float64)
    n = v.size
    if n == 0:
        return (float("nan"), float("nan"))
    f = stat or (lambda a: float(np.mean(a)))
    theta = f(v)
    if n == 1 or np.all(v == v[0]):
        return (theta, theta)
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, n, size=(boot, n))
    if stat is None:
        thetas = v[idx].mean(axis=1)
    else:
        thetas = np.array([f(v[i]) for i in idx])
    prop = (np.count_nonzero(thetas < theta) + 0.5 * np.count_nonzero(thetas == theta)) / boot
    prop = min(max(prop, 1 / (boot + 1)), boot / (boot + 1))
    z0 = norm.ppf(prop)
    jack = np.array([f(np.delete(v, i)) for i in range(n)])
    jm = jack.mean()
    num = np.sum((jm - jack) ** 3)
    den = 6.0 * np.sum((jm - jack) ** 2) ** 1.5
    a = num / den if den > 0 else 0.0
    alpha = 1 - conf
    out = []
    for q in (alpha / 2, 1 - alpha / 2):
        zq = norm.ppf(q)
        adj = norm.cdf(z0 + (z0 + zq) / (1 - a * (z0 + zq)))
        out.append(float(np.quantile(thetas, adj)))
    return (out[0], out[1])


def percentile_upper(values: Sequence[float], q: float) -> float:
    return float(np.quantile(np.asarray(values, dtype=np.float64), q))


# ----------------------------------------------------------------------------- binomial
def binom_crit(n: int, p0: float, alpha: float) -> int:
    """Largest k with P(Bin(n, p0) <= k) <= alpha; -1 if even k = 0 exceeds alpha."""
    if binom.cdf(0, n, p0) > alpha:
        return -1
    k = int(binom.ppf(alpha, n, p0))
    while k >= 0 and binom.cdf(k, n, p0) > alpha:
        k -= 1
    while binom.cdf(k + 1, n, p0) <= alpha:
        k += 1
    return k


def binom_size(n: int, p0: float, crit: int) -> float:
    return 0.0 if crit < 0 else float(binom.cdf(crit, n, p0))


def binom_power(n: int, p1: float, crit: int) -> float:
    return 0.0 if crit < 0 else float(binom.cdf(crit, n, p1))


def binom_min_n(p0: float, alpha: float) -> int:
    """Smallest N at which the one-sided exact test can reject at all: (1 - p0)^N <= alpha."""
    n = max(1, math.ceil(math.log(alpha) / math.log(1 - p0)))
    while n > 1 and (1 - p0) ** (n - 1) <= alpha:
        n -= 1
    while (1 - p0) ** n > alpha:
        n += 1
    return n


def wilson(k: int, n: int, conf: float = 0.95) -> tuple[float, float]:
    if n == 0:
        return (float("nan"), float("nan"))
    ci = binomtest(k, n).proportion_ci(confidence_level=conf, method="wilson")
    return (float(ci.low), float(ci.high))


def clopper_pearson(k: int, n: int, conf: float = 0.95) -> tuple[float, float]:
    if n == 0:
        return (float("nan"), float("nan"))
    ci = binomtest(k, n).proportion_ci(confidence_level=conf, method="exact")
    return (float(ci.low), float(ci.high))


def mcnemar(b: int, c: int) -> dict:
    """Exact and mid-p McNemar on discordant counts b, c [fagerland2013mcnemar]."""
    n = b + c
    if n == 0:
        return {"b": b, "c": c, "exact_p": 1.0, "midp": 1.0}
    k = min(b, c)
    exact = min(1.0, 2 * float(binom.cdf(k, n, 0.5)))
    midp = min(1.0, 2 * (float(binom.cdf(k, n, 0.5)) - 0.5 * float(binom.pmf(k, n, 0.5))))
    return {"b": b, "c": c, "exact_p": exact, "midp": midp}


# ----------------------------------------------------------------------------- power
def mde(n: int, sd: float, alpha: float, power: float = 0.8) -> float:
    return (norm.ppf(1 - alpha / 2) + norm.ppf(power)) * sd / math.sqrt(n)


def ni_power(n: int, sd: float, delta: float, alpha: float, theta: float = 0.0) -> float:
    """Phi((delta + theta) sqrt(n) / sd - z_{1-alpha}), one-sided alpha (PLAN preamble)."""
    return float(norm.cdf((delta + theta) * math.sqrt(n) / sd - norm.ppf(1 - alpha)))


def harm_power(n: int, sd: float, effect: float, alpha: float) -> float:
    """Phi(effect sqrt(n) / sd - z_{1-alpha/2}), two-sided alpha (PLAN preamble)."""
    return float(norm.cdf(effect * math.sqrt(n) / sd - norm.ppf(1 - alpha / 2)))


def sd_floor(ma: int, p: float = 0.5) -> float:
    """Sampling floor of sigma_d: sqrt(2 p (1 - p) / (m a)) (PLAN 3.3)."""
    return math.sqrt(2 * p * (1 - p) / ma)


# ----------------------------------------------------------------------------- Holm
def holm(pvals: Mapping[str, float], alpha: float = 0.05) -> dict[str, dict]:
    """Holm step-down. Returns per hypothesis: p, rank, level (None if the procedure stopped
    before reaching it), adjusted p and rejected."""
    items = sorted(pvals.items(), key=lambda kv: (kv[1], kv[0]))
    m = len(items)
    out: dict[str, dict] = {}
    running = 0.0
    stopped = False
    for i, (name, p) in enumerate(items):
        running = max(running, min(1.0, (m - i) * p))
        level = alpha / (m - i)
        rejected = (not stopped) and p < level  # falsified iff adjusted p >= alpha (PLAN 3)
        out[name] = {
            "p": p,
            "rank": i + 1,
            "level": None if stopped else level,
            "adjusted": running,
            "rejected": rejected,
        }
        if not rejected:
            stopped = True
    return out
