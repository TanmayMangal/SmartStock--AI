const router = require('express').Router();
const db = require('../db');

// Record a sale: checks stock, stores the sale, deducts stock and logs the movement atomically.
router.post('/', async (req, res) => {
  const product_id = parseInt(req.body?.product_id, 10);
  const quantity = parseInt(req.body?.quantity, 10);
  const sale_date = req.body?.sale_date || new Date().toISOString().slice(0, 10);
  if (!product_id || !(quantity > 0)) return res.status(400).json({ error: 'Product and a quantity above 0 are required' });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[p]] = await conn.query('SELECT price, quantity FROM products WHERE id=? FOR UPDATE', [product_id]);
    if (!p) { await conn.rollback(); return res.status(404).json({ error: 'Product not found' }); }
    if (p.quantity < quantity) {
      await conn.rollback();
      return res.status(400).json({ error: `Only ${p.quantity} in stock` });
    }
    const total = Number(p.price) * quantity;
    const [r] = await conn.query(
      'INSERT INTO sales (product_id, quantity, unit_price, total_amount, sale_date, user_id) VALUES (?,?,?,?,?,?)',
      [product_id, quantity, p.price, total, sale_date, req.user.id]);
    const after = p.quantity - quantity;
    await conn.query('UPDATE products SET quantity=? WHERE id=?', [after, product_id]);
    await conn.query(
      "INSERT INTO stock_movements (product_id, change_qty, reason, reference_id, balance_after) VALUES (?,?, 'sale', ?, ?)",
      [product_id, -quantity, r.insertId, after]);
    await conn.commit();
    res.status(201).json({ id: r.insertId, total_amount: total, quantity_left: after });
  } catch (e) { await conn.rollback(); console.error(e); res.status(500).json({ error: 'Could not record sale' }); }
  finally { conn.release(); }
});

router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
  const [rows] = await db.query(
    `SELECT s.*, p.name AS product, p.sku FROM sales s JOIN products p ON p.id = s.product_id
      ORDER BY s.sale_date DESC, s.id DESC LIMIT ?`, [limit]);
  res.json(rows);
});

// Daily / weekly / monthly summaries, anchored to the most recent sale date in the data
router.get('/summary', async (req, res) => {
  const period = ['daily', 'weekly', 'monthly'].includes(req.query.period) ? req.query.period : 'daily';
  const fmt = {
    daily:   { key: 'sale_date',                          size: 30 },
    weekly:  { key: "DATE_FORMAT(sale_date, '%x-W%v')",   size: 12 },
    monthly: { key: "DATE_FORMAT(sale_date, '%Y-%m')",    size: 12 },
  }[period];
  const [rows] = await db.query(
    `SELECT ${fmt.key} AS label, SUM(quantity) AS units, SUM(total_amount) AS revenue, MAX(sale_date) AS last_day
       FROM sales GROUP BY label ORDER BY last_day DESC LIMIT ?`, [fmt.size]);
  res.json(rows.reverse());
});

module.exports = router;
