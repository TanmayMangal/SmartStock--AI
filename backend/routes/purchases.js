const router = require('express').Router();
const db = require('../db');

// Record a stock purchase from a supplier: increases stock and logs the movement atomically.
router.post('/', async (req, res) => {
  const supplier_id = parseInt(req.body?.supplier_id, 10);
  const product_id = parseInt(req.body?.product_id, 10);
  const quantity = parseInt(req.body?.quantity, 10);
  const unit_cost = Number(req.body?.unit_cost);
  const purchase_date = req.body?.purchase_date || new Date().toISOString().slice(0, 10);
  if (!supplier_id || !product_id || !(quantity > 0) || !(unit_cost >= 0))
    return res.status(400).json({ error: 'Supplier, product, quantity (>0) and unit cost are required' });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[p]] = await conn.query('SELECT quantity FROM products WHERE id=? FOR UPDATE', [product_id]);
    if (!p) { await conn.rollback(); return res.status(404).json({ error: 'Product not found' }); }
    const [r] = await conn.query(
      `INSERT INTO purchases (supplier_id, product_id, quantity, unit_cost, total_cost, purchase_date, user_id)
       VALUES (?,?,?,?,?,?,?)`,
      [supplier_id, product_id, quantity, unit_cost, unit_cost * quantity, purchase_date, req.user.id]);
    const after = p.quantity + quantity;
    await conn.query('UPDATE products SET quantity=? WHERE id=?', [after, product_id]);
    await conn.query(
      "INSERT INTO stock_movements (product_id, change_qty, reason, reference_id, balance_after) VALUES (?,?, 'purchase', ?, ?)",
      [product_id, quantity, r.insertId, after]);
    await conn.commit();
    res.status(201).json({ id: r.insertId, quantity_now: after });
  } catch (e) { await conn.rollback(); console.error(e); res.status(500).json({ error: 'Could not record purchase' }); }
  finally { conn.release(); }
});

router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
  const [rows] = await db.query(
    `SELECT pu.*, p.name AS product, s.name AS supplier
       FROM purchases pu JOIN products p ON p.id = pu.product_id JOIN suppliers s ON s.id = pu.supplier_id
      ORDER BY pu.purchase_date DESC, pu.id DESC LIMIT ?`, [limit]);
  res.json(rows);
});

module.exports = router;
