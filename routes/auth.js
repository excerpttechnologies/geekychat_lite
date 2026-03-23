const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { generateToken, protect } = require('../middleware/auth');

// ─── Seed default admin on startup ───────────────────────────────────────────
const seedAdmin = async () => {
  try {
    const exists = await User.findOne({ email: 'Excerptech@geekychat.com' });
    if (!exists) {
      const admin = new User({
        email: 'Excerptech@geekychat.com',
        password: 'ExcerptGeekychat#2026', // will be hashed by pre-save hook
        name: 'Admin',
        role: 'admin'
      });
      await admin.save();
     
    }
  } catch (err) {
    console.error('Admin seed error:', err.message);
  }
};
seedAdmin();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid credentials' });
    }

    if (user.isBlocked) {
      return res.status(403).json({ success: false, message: 'Account blocked. Contact admin.' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Invalid credentials' });
    }

    const token = generateToken(user._id);

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        platformFeePaid: user.platformFeePaid,
        freeMessagesSent: user.freeMessagesSent,
        freeMessagesUsed: user.freeMessagesUsed,
        assignedPhone: user.assignedPhone
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/auth/me — get current user
router.get('/me', protect, async (req, res) => {
  res.json({ success: true, user: req.user });
});

module.exports = router;
