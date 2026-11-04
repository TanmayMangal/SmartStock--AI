"""Compare three demand-forecasting models on a chronological hold-out set.

  1. Moving Average (7-day)  - baseline
  2. Linear Regression
  3. Random Forest Regressor - primary model

Split is CHRONOLOGICAL per product: first 80% of days train, last 20% test.
Metrics: MAE and RMSE (one-step-ahead predictions on the test days, using only
information from earlier days).

Outputs in ./results: model_comparison.csv, model_comparison.json,
model_comparison.png, actual_vs_predicted.png
"""
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error

from features import FEATURES, build_features, chronological_split

HERE = Path(__file__).parent
RES = HERE / "results"
RES.mkdir(exist_ok=True)

sales = pd.read_csv(HERE / "data" / "synthetic_sales.csv", parse_dates=["date"])
names = pd.read_csv(HERE / "data" / "products.csv").set_index("product_id")["name"].to_dict()


def rmse(y, p):
    return float(np.sqrt(mean_squared_error(y, p)))


rows, preds_for_plot = [], {}
for pid, g in sales.groupby("product_id"):
    df = build_features(g.rename(columns={"quantity_sold": "qty"})[["date", "qty"]])
    train, test = chronological_split(df, 0.2)

    ma_pred = test["roll7"].values                       # moving-average baseline
    lr = LinearRegression().fit(train[FEATURES], train["qty"])
    lr_pred = np.clip(lr.predict(test[FEATURES]), 0, None)
    rf = RandomForestRegressor(n_estimators=200, min_samples_leaf=3, random_state=42, n_jobs=-1)
    rf.fit(train[FEATURES], train["qty"])
    rf_pred = rf.predict(test[FEATURES])

    for model, p in [("Moving Average (7d)", ma_pred), ("Linear Regression", lr_pred),
                     ("Random Forest", rf_pred)]:
        rows.append({"product_id": int(pid), "product": names.get(pid, str(pid)), "model": model,
                     "MAE": mean_absolute_error(test["qty"], p), "RMSE": rmse(test["qty"], p)})
    if pid == 1:
        preds_for_plot = dict(date=test["date"].values, actual=test["qty"].values,
                              ma=ma_pred, lr=lr_pred, rf=rf_pred)

res = pd.DataFrame(rows)
res.to_csv(RES / "model_comparison.csv", index=False)
summary = (res.groupby("model")[["MAE", "RMSE"]].mean().round(3)
           .sort_values("RMSE").reset_index())
print("\nAverage over all products (lower is better):\n")
print(summary.to_string(index=False))

wins = (res.loc[res.groupby("product_id")["RMSE"].idxmin(), "model"].value_counts().to_dict())
print("\nProducts where each model had the lowest RMSE:", wins)

with open(RES / "model_comparison.json", "w") as f:
    json.dump({"data_note": "Computed on SYNTHETIC data - not real business records.",
               "split": "chronological, first 80% train / last 20% test, per product",
               "summary": summary.to_dict(orient="records"),
               "best_model_counts": wins,
               "per_product": res.round(3).to_dict(orient="records")}, f, indent=2)

# --- plots ---------------------------------------------------------------
fig, ax = plt.subplots(1, 2, figsize=(10, 4))
for a, metric in zip(ax, ["MAE", "RMSE"]):
    a.bar(summary["model"], summary[metric], color=["#2a9d8f", "#e9c46a", "#e76f51"])
    a.set_title(f"Average {metric} (synthetic data)")
    a.tick_params(axis="x", rotation=15)
plt.tight_layout(); plt.savefig(RES / "model_comparison.png", dpi=150); plt.close()

if preds_for_plot:
    p = preds_for_plot
    plt.figure(figsize=(11, 4))
    plt.plot(p["date"], p["actual"], label="Actual", color="black", lw=1.2)
    plt.plot(p["date"], p["ma"], label="Moving avg", alpha=.7)
    plt.plot(p["date"], p["rf"], label="Random Forest", alpha=.9)
    plt.title(f"{names.get(1)} - test period, actual vs predicted (synthetic data)")
    plt.legend(); plt.tight_layout(); plt.savefig(RES / "actual_vs_predicted.png", dpi=150); plt.close()
print("\nSaved results to", RES)
