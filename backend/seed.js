// Loads the SYNTHETIC demo dataset (ml-service/data/*.csv) into MySQL.
// Everything inserted is flagged is_synthetic = 1. It is NOT real business data.
// Usage: npm run seed      (run database/schema.sql first)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./db');

const DATA = path.join(__dirname, '..', 'ml-service', 'data');

function readCsv(file) {
  const [head, ...lines] = fs.readFileSync(path.join(DATA, file), 'utf8').trim().split(/\r?\n/);
  const cols = head.split(',');
  return lines.map(l => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
}

(async () => {
  const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM products WHERE is_synthetic = 1');
  if (n > 0) { console.log('Synthetic data already loaded. Truncate tables to reseed.'); process.exit(0); }

  const products = readCsv('products.csv');
  const sales = readCsv('synthetic_sales.csv');

  const cats = [...new Set(products.map(p => p.category))];
  for (const c of cats) await db.query('INSERT IGNORE INTO categories (name) VALUES (?)', [c]);
  const sups = [...new Set(products.map(p => p.supplier))];
  for (const s of sups) await db.query('INSERT INTO suppliers (name, contact) VALUES (?, ?)', [s, 'Demo contact (synthetic)']);
  const [catRows] = await db.query('SELECT id, name FROM categories');
  const [supRows] = await db.query('SELECT id, name FROM suppliers');
  const catId = Object.fromEntries(catRows.map(r => [r.name, r.id]));
  const supId = Object.fromEntries(supRows.map(r => [r.name, r.id]));

  const idMap = {}; // csv product_id -> db id
  for (const p of products) {
    const [r] = await db.query(
      `INSERT INTO products (sku,name,category_id,supplier_id,price,quantity,reorder_level,lead_time_days,description,is_synthetic)
       VALUES (?,?,?,?,?,?,?,?,?,1)`,
      [p.sku, p.name, catId[p.category], supId[p.supplier], p.price, p.quantity, p.reorder_level,
       p.lead_time_days, 'Synthetic demo product']);
    idMap[p.product_id] = r.insertId;
    await db.query("INSERT INTO stock_movements (product_id, change_qty, reason, balance_after) VALUES (?,?, 'initial', ?)",
      [r.insertId, p.quantity, p.quantity]);
  }

  // bulk insert daily sales (skip zero-quantity days; the forecaster zero-fills gaps)
  const rows = sales.filter(s => Number(s.quantity_sold) > 0)
    .map(s => [idMap[s.product_id], Number(s.quantity_sold), Number(s.price),
               Number(s.quantity_sold) * Number(s.price), s.date, 1]);
  for (let i = 0; i < rows.length; i += 1000) {
    await db.query(
      'INSERT INTO sales (product_id, quantity, unit_price, total_amount, sale_date, is_synthetic) VALUES ?',
      [rows.slice(i, i + 1000)]);
  }
  console.log(`Loaded ${products.length} synthetic products and ${rows.length} synthetic sales rows.`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
