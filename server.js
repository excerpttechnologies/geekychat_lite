const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

// Load .env from the backend folder explicitly
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ─── MongoDB ──────────────────────────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI_MINI || process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('\n❌ ERROR: No MongoDB URI found!');
  console.error('   Create a file called .env inside the backend folder with this content:');
  console.error('   MONGO_URI_MINI=mongodb+srv://youruser:yourpass@cluster.mongodb.net/whatsapp_mini\n');
  process.exit(1);
}

console.log('🔌 Connecting to MongoDB...');
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => {
    console.error('❌ DB connection failed:', err.message);
    process.exit(1);
  });


app.use(express.static(path.join(__dirname, 'dist')));

// Fallback route for SPA (React Router)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});



// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth',  require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/user',  require('./routes/user'));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Mini WhatsApp Platform API running' });
});

  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Serve frontend in production ────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../frontend/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/dist', 'index.html'));
  });
}

const PORT = process.env.MINI_PORT || 8004;
app.listen(PORT, () => console.log(`🚀 Mini platform running on port ${PORT}`));
