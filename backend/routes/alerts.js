const router = require('express').Router();
const db = require('../db');

// Low-stock and out-of-stock alerts (instant; ML-based stockout predictions are in /api/forecast/stockout-risk)
router.get('/', async (_req, res) => {
  const [rows] = await db.query(
    `SELECT p.id, p.sku, p.name, p.quantity, p.reorder_level, s.name AS supplier,
            CASE WHEN p.quantity = 0 THEN 'out' ELSE 'low' END AS level
       FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.quantity <= p.reorder_level
      ORDER BY p.quantity ASC, p.name`);
  res.json(rows);
});

// Stock movement history
router.get('/movements', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const args = [];
  let where = '';
  if (req.query.product_id) { where = 'WHERE m.product_id = ?'; args.push(req.query.product_id); }
  const [rows] = await db.query(
    `SELECT m.*, p.name AS product FROM stock_movements m JOIN products p ON p.id = m.product_id
      ${where} ORDER BY m.id DESC LIMIT ?`, [...args, limit]);
  res.json(rows);
});

// Dashboard numbers
router.get('/dashboard', async (_req, res) => {
  const [[t]] = await db.query(
    `SELECT COUNT(*) AS products, COALESCE(SUM(quantity*price),0) AS stock_value,
            SUM(quantity = 0) AS out_count, SUM(quantity > 0 AND quantity <= reorder_level) AS low_count
       FROM products`);
  const [[last]] = await db.query('SELECT MAX(sale_date) AS d FROM sales');
  let today = { units: 0, revenue: 0 }, top = [];
  if (last.d) {
    const [[s]] = await db.query(
      'SELECT COALESCE(SUM(quantity),0) AS units, COALESCE(SUM(total_amount),0) AS revenue FROM sales WHERE sale_date = ?', [last.d]);
    today = s;
    [top] = await db.query(
      `SELECT p.name, SUM(s.quantity) AS units FROM sales s JOIN products p ON p.id = s.product_id
        WHERE s.sale_date > DATE_SUB(?, INTERVAL 30 DAY) GROUP BY p.id ORDER BY units DESC LIMIT 5`, [last.d]);
  }
  res.json({ ...t, latest_sale_date: last.d, latest_day_sales: today, top_products_30d: top });
});

module.exports = router;
