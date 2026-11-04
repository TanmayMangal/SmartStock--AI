const router = require('express').Router();
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

router.get('/', async (_req, res) => {
  const [rows] = await db.query(
    `SELECT s.*, COUNT(p.id) AS product_count
       FROM suppliers s LEFT JOIN products p ON p.supplier_id = s.id
      GROUP BY s.id ORDER BY s.name`);
  res.json(rows);
});

router.get('/:id/products', async (req, res) => {
  const [rows] = await db.query('SELECT id, sku, name, quantity FROM products WHERE supplier_id=? ORDER BY name', [req.params.id]);
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { name, contact, phone, email, address } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Supplier name is required' });
  const [r] = await db.query(
    'INSERT INTO suppliers (name, contact, phone, email, address) VALUES (?,?,?,?,?)',
    [name.trim(), contact || null, phone || null, email || null, address || null]);
  res.status(201).json({ id: r.insertId });
});

router.put('/:id', async (req, res) => {
  const { name, contact, phone, email, address } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Supplier name is required' });
  const [r] = await db.query(
    'UPDATE suppliers SET name=?, contact=?, phone=?, email=?, address=? WHERE id=?',
    [name.trim(), contact || null, phone || null, email || null, address || null, req.params.id]);
  r.affectedRows ? res.json({ ok: true }) : res.status(404).json({ error: 'Supplier not found' });
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const [r] = await db.query('DELETE FROM suppliers WHERE id=?', [req.params.id]);
  r.affectedRows ? res.json({ ok: true }) : res.status(404).json({ error: 'Supplier not found' });
});

module.exports = router;
