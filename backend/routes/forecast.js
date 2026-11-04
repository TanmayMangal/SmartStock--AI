const router = require('express').Router();
const db = require('../db');

const ML_URL = process.env.ML_URL || 'http://localhost:5001';

async function callML(path, options) {
  const r = await fetch(ML_URL + path, { signal: AbortSignal.timeout(30000), ...options });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `ML service returned ${r.status}`);
  return data;
}

// Forecast one product using its stored daily sales history.
async function forecastProduct(productId, horizon) {
  const [[p]] = await db.query('SELECT id, name, quantity, lead_time_days FROM products WHERE id=?', [productId]);
  if (!p) return null;
  const [hist] = await db.query(
    `SELECT sale_date AS date, SUM(quantity) AS qty FROM sales WHERE product_id=? GROUP BY sale_date ORDER BY sale_date`,
    [productId]);
  if (!hist.length) return { product: p, error: 'No sales history yet' };
  const history = hist.map(h => ({ date: h.date, qty: Number(h.qty) }));
  const result = await callML('/forecast', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product_id: p.id, history, horizon, current_stock: p.quantity, lead_time_days: p.lead_time_days }),
  });
  return { product: p, recent_history: history.slice(-30), ...result };
}

router.get('/model-metrics', async (_req, res) => {
  try { res.json(await callML('/metrics')); }
  catch (e) { res.status(502).json({ error: 'ML service unavailable: ' + e.message }); }
});

// Products predicted to run out within `days` days (default 14)
router.get('/stockout-risk', async (req, res) => {
  const horizon = Math.min(parseInt(req.query.days, 10) || 14, 60);
  try {
    const [products] = await db.query('SELECT id FROM products WHERE quantity > 0');
    const out = [];
    for (const { id } of products) {
      const f = await forecastProduct(id, horizon);
      if (f && f.predicted_stockout_date)
        out.push({ product_id: id, product: f.product.name, quantity: f.product.quantity,
                   predicted_stockout_date: f.predicted_stockout_date, suggested_reorder_qty: f.suggested_reorder_qty });
    }
    out.sort((a, b) => a.predicted_stockout_date.localeCompare(b.predicted_stockout_date));
    res.json(out);
  } catch (e) { res.status(502).json({ error: 'ML service unavailable: ' + e.message }); }
});

router.get('/:productId', async (req, res) => {
  const horizon = Math.min(parseInt(req.query.days, 10) || 14, 60);
  try {
    const f = await forecastProduct(req.params.productId, horizon);
    if (!f) return res.status(404).json({ error: 'Product not found' });
    if (f.error) return res.status(400).json({ error: f.error });
    res.json(f);
  } catch (e) { res.status(502).json({ error: 'ML service unavailable. Is it running on ' + ML_URL + '? (' + e.message + ')' }); }
});

module.exports = router;
