"""Generate a SYNTHETIC daily sales dataset for SmartStock AI.

!! This data is artificial. It is NOT a record of any real business. !!
It exists so the forecasting pipeline can be developed, tested and demonstrated.
Replace data/synthetic_sales.csv with real exported sales to use real data
(same columns).

Outputs (in ./data):
  products.csv         - product master list (synthetic)
  synthetic_sales.csv  - date, product_id, category, quantity_sold, current_inventory, price
"""
import numpy as np
import pandas as pd
from pathlib import Path

rng = np.random.default_rng(42)
OUT = Path(__file__).parent / "data"
OUT.mkdir(exist_ok=True)

# sku, name, category, supplier, price (INR), base daily demand, seasonality profile
PRODUCTS = [
    ("RICE-5KG",  "Basmati Rice 5kg",        "Grocery",       "Sharma Wholesale", 420, 9,  "flat"),
    ("ATTA-10KG", "Wheat Flour 10kg",        "Grocery",       "Sharma Wholesale", 390, 7,  "flat"),
    ("OIL-1L",    "Sunflower Oil 1L",        "Grocery",       "Sharma Wholesale", 150, 12, "festive"),
    ("SUGAR-1KG", "Sugar 1kg",               "Grocery",       "Sharma Wholesale", 46,  18, "festive"),
    ("TEA-250G",  "Tea 250g",                "Beverages",     "Gupta Distributors", 120, 10, "winter"),
    ("COLD-125L", "Cold Drink 1.25L",        "Beverages",     "Gupta Distributors", 70,  14, "summer"),
    ("BISC-PK",   "Biscuit Family Pack",     "Snacks",        "Gupta Distributors", 35,  22, "flat"),
    ("NOOD-PK",   "Instant Noodles 5-pack",  "Snacks",        "Gupta Distributors", 70,  11, "winter"),
    ("MILK-1L",   "Packaged Milk 1L",        "Dairy",         "Rajasthan Dairy Co", 56,  40, "flat"),
    ("NOTE-200",  "Notebook 200 pages",      "Stationery",    "City Stationers",  60,  6,  "school"),
    ("SOAP-BAR",  "Bathing Soap",            "Personal Care", "City Stationers",  38,  16, "summer"),
    ("SHAM-180",  "Shampoo 180ml",           "Personal Care", "City Stationers",  165, 5,  "flat"),
]

DATES = pd.date_range("2024-11-01", "2026-10-31", freq="D")
WEEKDAY = np.array([0.90, 0.88, 0.92, 0.95, 1.10, 1.30, 1.20])  # Mon..Sun


def seasonal(profile, m):
    if profile == "summer":  return 1.0 + 0.55 * np.exp(-((m - 5.5) ** 2) / 6)
    if profile == "winter":  return 1.0 + 0.45 * np.exp(-((min(m, 12 - m + 1) - 1) ** 2) / 5)
    if profile == "festive": return 1.0 + 0.50 * np.exp(-((m - 10.5) ** 2) / 2)
    if profile == "school":  return 1.0 + 0.90 * np.exp(-((m - 6.5) ** 2) / 1.5)
    return 1.0


rows, prod_rows = [], []
for pid, (sku, name, cat, sup, price, base, prof) in enumerate(PRODUCTS, start=1):
    growth = rng.uniform(0.00, 0.12)                  # slow yearly growth
    stock, reorder_to = base * 20, base * 25
    for i, d in enumerate(DATES):
        lam = (base * WEEKDAY[d.dayofweek] * seasonal(prof, d.month)
               * (1 + growth * i / 365) * (1 + 0.04 * np.sin(i / 11.0)))
        qty = int(min(rng.poisson(lam), stock))       # cannot sell more than we have
        stock -= qty
        if stock < base * 6:                          # simple restocking policy
            stock = int(reorder_to)
        rows.append((d.date(), pid, cat, qty, stock, price))
    prod_rows.append((pid, sku, name, cat, sup, price, int(stock), max(5, int(base * 4)), 3))

pd.DataFrame(rows, columns=["date", "product_id", "category", "quantity_sold",
                            "current_inventory", "price"]).to_csv(OUT / "synthetic_sales.csv", index=False)
pd.DataFrame(prod_rows, columns=["product_id", "sku", "name", "category", "supplier",
                                 "price", "quantity", "reorder_level", "lead_time_days"]
             ).to_csv(OUT / "products.csv", index=False)
print(f"SYNTHETIC data written: {len(rows)} sales rows, {len(PRODUCTS)} products -> {OUT}")
