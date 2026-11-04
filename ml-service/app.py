"""Flask forecasting API for SmartStock AI (runs on http://localhost:5001).

POST /forecast
  {
    "product_id": 3,
    "history": [{"date": "2026-01-01", "qty": 12}, ...],   # daily sales, oldest first
    "horizon": 14,
    "current_stock": 120,
    "lead_time_days": 3
  }
-> forecast per day, predicted stockout date, suggested reorder quantity.

The Node backend sends the history from MySQL; this service keeps no database.
"""
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
from flask import Flask, jsonify, request
from sklearn.ensemble import RandomForestRegressor

from features import FEATURES, build_features, chronological_split, next_day_features

app = Flask(__name__)
RESULTS = Path(__file__).parent / "results" / "model_comparison.json"
MIN_DAYS_FOR_ML = 60
_cache = {}   # (product_id, last_date, n_rows) -> (model, residual_rmse)


def prepare_history(history):
    df = pd.DataFrame(history)
    df["date"] = pd.to_datetime(df["date"])
    df = df.groupby("date", as_index=False)["qty"].sum().sort_values("date")
    full = pd.date_range(df["date"].min(), df["date"].max(), freq="D")
    return df.set_index("date").reindex(full, fill_value=0).rename_axis("date").reset_index()


def get_model(pid, daily):
    key = (pid, str(daily["date"].iloc[-1].date()), len(daily))
    if key in _cache:
        return _cache[key]
    feats = build_features(daily)
    train, test = chronological_split(feats, 0.2)
    check = RandomForestRegressor(n_estimators=100, min_samples_leaf=3, random_state=42, n_jobs=-1)
    check.fit(train[FEATURES], train["qty"])
    err = float(np.sqrt(np.mean((check.predict(test[FEATURES]) - test["qty"]) ** 2)))
    final = RandomForestRegressor(n_estimators=150, min_samples_leaf=3, random_state=42, n_jobs=-1)
    final.fit(feats[FEATURES], feats["qty"])        # refit on all data for the live forecast
    _cache[key] = (final, err)
    return _cache[key]


@app.get("/health")
def health():
    return jsonify(status="ok")


@app.get("/metrics")
def metrics():
    if not RESULTS.exists():
        return jsonify(error="Run train_models.py first"), 404
    return jsonify(json.loads(RESULTS.read_text()))


@app.post("/forecast")
def forecast():
    body = request.get_json(force=True)
    history = body.get("history") or []
    horizon = int(body.get("horizon", 14))
    stock = float(body.get("current_stock", 0))
    lead = int(body.get("lead_time_days", 3))
    if not history:
        return jsonify(error="No sales history for this product"), 400

    daily = prepare_history(history)
    hist = daily["qty"].astype(float).tolist()
    last = daily["date"].iloc[-1]
    use_ml = len(daily) >= MIN_DAYS_FOR_ML
    method, resid = "Random Forest", 0.0
    if use_ml:
        model, resid = get_model(body.get("product_id", 0), daily)
    else:
        method = "Moving Average (not enough history for ML)"

    out = []
    for i in range(1, horizon + 1):
        d = last + pd.Timedelta(days=i)
        if use_ml:
            y = float(model.predict(pd.DataFrame([next_day_features(hist, d)], columns=FEATURES))[0])
        else:
            y = float(np.mean(hist[-7:]))
        y = max(0.0, y)
        hist.append(y)                               # recursive multi-step forecast
        out.append({"date": str(d.date()), "predicted_qty": round(y, 2)})

    # stockout date: first day cumulative forecast demand exceeds current stock
    cum, stockout = 0.0, None
    for row in out:
        cum += row["predicted_qty"]
        if cum >= stock:
            stockout = row["date"]
            break
    total = sum(r["predicted_qty"] for r in out)
    safety = 1.65 * resid * math.sqrt(max(lead, 1))  # ~95% service level, heuristic
    reorder = max(0, math.ceil(total + safety - stock))
    return jsonify(method=method, horizon_days=horizon, forecast=out,
                   total_forecast_qty=round(total, 1), predicted_stockout_date=stockout,
                   safety_stock=round(safety, 1), suggested_reorder_qty=reorder,
                   holdout_rmse=round(resid, 2))


if __name__ == "__main__":
    app.run(port=5001, debug=False)
