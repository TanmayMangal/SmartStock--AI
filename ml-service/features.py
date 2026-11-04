"""Shared feature engineering for SmartStock AI.

Leakage rule: every lag / rolling feature for day t is computed ONLY from
quantities up to day t-1 (we shift by 1 before rolling). The target is the
quantity sold on day t.
"""
import numpy as np
import pandas as pd

FEATURES = ["dow", "month", "lag1", "lag7", "roll7", "roll30", "trend"]


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """df needs columns: date (datetime64), qty (number); one row per day, one product."""
    df = df.sort_values("date").reset_index(drop=True).copy()
    s = df["qty"].astype(float)
    df["dow"] = df["date"].dt.dayofweek
    df["month"] = df["date"].dt.month
    df["lag1"] = s.shift(1)
    df["lag7"] = s.shift(7)
    df["roll7"] = s.shift(1).rolling(7).mean()      # previous 7-day average
    df["roll30"] = s.shift(1).rolling(30).mean()    # previous 30-day average
    df["trend"] = df["roll7"] - df["roll30"]        # recent sales trend
    return df.dropna(subset=FEATURES).reset_index(drop=True)


def next_day_features(history, date: pd.Timestamp):
    """Feature vector for `date`, given quantities of all earlier days (list, oldest first)."""
    h = np.asarray(history, dtype=float)
    r7, r30 = h[-7:].mean(), h[-30:].mean()
    return [date.dayofweek, date.month, h[-1], h[-7], r7, r30, r7 - r30]


def chronological_split(df: pd.DataFrame, test_fraction: float = 0.2):
    """Oldest rows -> train, newest rows -> test. Never shuffles."""
    cut = int(len(df) * (1 - test_fraction))
    return df.iloc[:cut], df.iloc[cut:]
