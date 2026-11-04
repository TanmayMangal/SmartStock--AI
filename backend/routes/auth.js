const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { sign } = require('../middleware/auth');

// The first registered user becomes admin; everyone after is staff.
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM users');
    const hash = await bcrypt.hash(password, 10);
    const role = n === 0 ? 'admin' : 'staff';
    const [r] = await db.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)',
      [name.trim(), email.trim().toLowerCase(), hash, role]);
    const user = { id: r.insertId, name: name.trim(), role };
    res.status(201).json({ token: sign(user), user });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email already registered' });
    console.error(e); res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(password, u.password_hash)))
    return res.status(401).json({ error: 'Invalid email or password' });
  const user = { id: u.id, name: u.name, role: u.role };
  res.json({ token: sign(user), user });
});

// Logout is client-side with JWT (the client discards the token).
router.post('/logout', (_req, res) => res.json({ ok: true }));

module.exports = router;
