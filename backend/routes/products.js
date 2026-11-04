const router = require('express').Router();
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

// categories (kept here for simplicity)
router.get('/categories', async (_req, res) => {
  const [rows] = await db.query('SELECT * FROM categories ORDER BY name');
  res.json(rows);
});
router.post('/categories', async (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Category name required' });
  const [r] = await db.query('INSERT IGNORE INTO categories (name) VALUES (?)', [name]);
  const [[row]] = await db.query('SELECT * FROM categories WHERE name = ?', [name]);
  res.status(r.affectedRows ? 201 : 200).json(row);
});

// list + search + filter
router.get('/', async (req, res) => {
  const { q, category_id, status } = req.query;
  const where = [], args = [];
  if (q) { where.push('(p.name LIKE ? OR p.sku LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  if (category_id) { where.push('p.category_id = ?'); args.push(category_id); }
  if (status === 'out') where.push('p.quantity = 0');
  if (status === 'low') where.push('p.quantity > 0 AND p.quantity <= p.reorder_level');
  if (status === 'ok') where.push('p.quantity > p.reorder_level');
  const [rows] = await db.query(
    `SELECT p.*, c.name AS category, s.name AS supplier
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN suppliers  s ON s.id = p.supplier_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY p.name`, args);
  res.json(rows);
});

function clean(b) {
  return {
    sku: (b.sku || '').trim(), name: (b.name || '').trim(),
    category_id: b.category_id || null, supplier_id: b.supplier_id || null,
    price: Number(b.price), quantity: parseInt(b.quantity ?? 0, 10),
    reorder_level: parseInt(b.reorder_level ?? 10, 10),
    lead_time_days: parseInt(b.lead_time_days ?? 3, 10),
    description: b.description || null,
  };
}
function invalid(p) {
  if (!p.sku || !p.name) return 'SKU and name are required';
  if (!(p.price >= 0)) return 'Price must be a non-negative number';
  if (!(p.quantity >= 0) || !(p.reorder_level >= 0)) return 'Quantity and reorder level must be 0 or more';
  return null;
}

router.post('/', async (req, res) => {
  const p = clean(req.body || {});
  const err = invalid(p);
  if (err) return res.status(400).json({ error: err });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO products (sku,name,category_id,supplier_id,price,quantity,reorder_level,lead_time_days,description)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [p.sku, p.name, p.category_id, p.supplier_id, p.price, p.quantity, p.reorder_level, p.lead_time_days, p.description]);
    await conn.query(
      "INSERT INTO stock_movements (product_id, change_qty, reason, balance_after) VALUES (?,?, 'initial', ?)",
      [r.insertId, p.quantity, p.quantity]);
    await conn.commit();
    res.status(201).json({ id: r.insertId });
  } catch (e) {
    await conn.rollback();
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'SKU already exists' });
    console.error(e); res.status(500).json({ error: 'Could not add product' });
  } finally { conn.release(); }
});

// Update details. Quantity changes go through sales/purchases/adjust so history stays consistent.
router.put('/:id', async (req, res) => {
  const p = clean(req.body || {});
  const err = invalid({ ...p, quantity: 0 });
  if (err) return res.status(400).json({ error: err });
  try {
    const [r] = await db.query(
      `UPDATE products SET sku=?, name=?, category_id=?, supplier_id=?, price=?, reorder_level=?,
              lead_time_days=?, description=? WHERE id=?`,
      [p.sku, p.name, p.category_id, p.supplier_id, p.price, p.reorder_level, p.lead_time_days, p.description, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Product not found' });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'SKU already exists' });
    console.error(e); res.status(500).json({ error: 'Update failed' });
  }
});

// Manual stock correction (e.g. damaged goods, stock-take)
router.post('/:id/adjust', async (req, res) => {
  const delta = parseInt(req.body?.change, 10);
  if (!delta) return res.status(400).json({ error: 'Provide a non-zero integer "change"' });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[p]] = await conn.query('SELECT quantity FROM products WHERE id=? FOR UPDATE', [req.params.id]);
    if (!p) { await conn.rollback(); return res.status(404).json({ error: 'Product not found' }); }
    const after = p.quantity + delta;
    if (after < 0) { await conn.rollback(); return res.status(400).json({ error: 'Stock cannot go below 0' }); }
    await conn.query('UPDATE products SET quantity=? WHERE id=?', [after, req.params.id]);
    await conn.query(
      "INSERT INTO stock_movements (product_id, change_qty, reason, balance_after) VALUES (?,?, 'adjustment', ?)",
      [req.params.id, delta, after]);
    await conn.commit();
    res.json({ quantity: after });
  } catch (e) { await conn.rollback(); console.error(e); res.status(500).json({ error: 'Adjustment failed' }); }
  finally { conn.release(); }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const [r] = await db.query('DELETE FROM products WHERE id=?', [req.params.id]);
  r.affectedRows ? res.json({ ok: true }) : res.status(404).json({ error: 'Product not found' });
});

module.exports = router;
