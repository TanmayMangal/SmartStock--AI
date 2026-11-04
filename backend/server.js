require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { requireAuth } = require('./middleware/auth');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', requireAuth, require('./routes/products'));
app.use('/api/sales', requireAuth, require('./routes/sales'));
app.use('/api/suppliers', requireAuth, require('./routes/suppliers'));
app.use('/api/purchases', requireAuth, require('./routes/purchases'));
app.use('/api/alerts', requireAuth, require('./routes/alerts'));
app.use('/api/forecast', requireAuth, require('./routes/forecast'));

// Serve the frontend from the same origin (http://localhost:3000)
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`SmartStock AI running at http://localhost:${port}`));
