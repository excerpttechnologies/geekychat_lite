const express = require('express');
const router = express.Router();
const axios = require('axios');
const User = require('../models/User');
const Template = require('../models/Template');
const Campaign = require('../models/Campaign');
const { protect } = require('../middleware/auth');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const multer   = require('multer');      // ← add
const fs       = require('fs');          // ← add
const FormData = require('form-data');   // ← add

const upload = multer({ dest: 'uploads/' });

const getRazorpay = () => {
  const key_id     = process.env.RAZORPAY_KEY_ID     || 'rzp_test_qUmhUFElBiSNIs';
  const key_secret = process.env.RAZORPAY_KEY_SECRET || 'wsBV1ts8yJPld9JktATIdOiS';
  return new Razorpay({ key_id, key_secret });
};

const PLATFORM_FEE = 799; // ₹799 one-time

// All routes protected
router.use(protect);

// ────────────────────────────────────────
// GET /api/user/profile
// ────────────────────────────────────────
router.get('/profile', async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    res.json({ success: true, data: user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ────────────────────────────────────────
// GET /api/user/templates — templates assigned to this user
// ────────────────────────────────────────
router.get('/templates', async (req, res) => {
  try {
    const templates = await Template.find({
      assignedTo: req.user._id,
      status: 'approved'
    }).select('-createdBy -assignedTo');

    res.json({ success: true, data: templates });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ────────────────────────────────────────
// GET /api/user/campaigns — campaign history
// ────────────────────────────────────────
router.get('/campaigns', async (req, res) => {
  try {
    const campaigns = await Campaign.find({ userId: req.user._id })
      .sort({ createdAt: -1 });

    // Deduplicate messageDetails by phone — keep best status
    const statusPriority = { read: 4, delivered: 3, sent: 2, pending: 1, failed: 0 };

    const processed = campaigns.map(c => {
      const phoneMap = new Map();
      (c.messageDetails || []).forEach(msg => {
        const ph = msg.phoneNumber?.toString();
        if (!ph) return;
        const existing = phoneMap.get(ph);
        if (!existing) { phoneMap.set(ph, msg); return; }
        const ep = statusPriority[existing.status] ?? -1;
        const np = statusPriority[msg.status] ?? -1;
        if (np > ep) phoneMap.set(ph, msg);
        else if (np === ep) {
          const et = existing.sentAt ? new Date(existing.sentAt).getTime() : 0;
          const nt = msg.sentAt     ? new Date(msg.sentAt).getTime()     : 0;
          if (nt > et) phoneMap.set(ph, msg);
        }
      });

      const deduped = [...phoneMap.values()];
      const successful = deduped.filter(m => ['sent','delivered','read'].includes(m.status)).length;
      const failed     = deduped.filter(m => m.status === 'failed').length;
      const delivered  = deduped.filter(m => ['delivered','read'].includes(m.status)).length;
      const read       = deduped.filter(m => m.status === 'read').length;
      const total      = deduped.length;

      return {
        ...c.toObject(),
        messageDetails: deduped,
        stats: {
          totalContacts: total,
          successfulMessages: successful,
          failedMessages: failed,
          deliveredMessages: delivered,
          readMessages: read,
          successRate: total > 0 ? (successful / total) * 100 : 0
        }
      };
    });

    res.json({ success: true, data: processed });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});




















// routes/whatsapp.js

// 1. Upload media
// 1. Upload media — proxy to Facebook
router.post('/wa/upload-media', upload.single('file'), async (req, res) => {
  try {
    const phoneNumberId = req.body.phoneNumberId;
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    if (!phoneNumberId) {
      return res.status(400).json({ error: 'phoneNumberId is required' });
    }

    const formData = new FormData();
    formData.append('messaging_product', 'whatsapp');
    formData.append('file', fs.createReadStream(req.file.path), {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    const response = await axios.post(
      `https://graph.facebook.com/v23.0/${phoneNumberId}/media`,
      formData,
      { headers: { ...formData.getHeaders(), Authorization: `Bearer ${process.env.WA_TOKEN}` } }
    );

    // Clean up temp file
    fs.unlinkSync(req.file.path);
    res.json(response.data);

  } catch (err) {
    // Clean up temp file on error too
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
    console.error('❌ Upload media error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// 2. Send message — proxy to Facebook
router.post('/wa/send-message', async (req, res) => {
  try {
    const { phoneNumberId, payload } = req.body;
    if (!phoneNumberId || !payload) {
      return res.status(400).json({ error: 'phoneNumberId and payload required' });
    }

    const response = await axios.post(
      `https://graph.facebook.com/v23.0/${phoneNumberId}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.WA_TOKEN}`,
          'Content-Type': 'application/json',
        }
      }
    );
    res.json(response.data);

  } catch (err) {
    console.error('❌ Send message error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});













// ────────────────────────────────────────
// POST /api/user/campaigns/batch — save batch after sending
// ────────────────────────────────────────
router.post('/campaigns/batch', async (req, res) => {
  try {
    const {
      campaignName, templateName, phoneNumberId, headerType,
      category, contacts, messageDetails, status,
      batchNumber, campaignId, stats, isFreeDemo,
      paymentId, amountPaid
    } = req.body;

    const campaign = new Campaign({
      userId:      req.user._id,
      campaignName,
      templateName,
      phoneNumberId,
      headerType:  headerType || 'TEXT',
      category:    category   || 'MARKETING',
      contacts:    contacts   || [],
      messageDetails: messageDetails || [],
      status:      status     || 'completed',
      batchNumber: batchNumber || 1,
      campaignId:  campaignId || '',
      stats:       stats      || {},
      isFreeDemo:  isFreeDemo || false,
      paymentId:   paymentId  || '',
      amountPaid:  amountPaid || 0
    });

    await campaign.save();
    res.json({ success: true, data: campaign });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ────────────────────────────────────────
// POST /api/user/campaigns/calculate-cost
// ────────────────────────────────────────
router.post('/campaigns/calculate-cost', async (req, res) => {
  try {
    const { contactCount, headerType, category } = req.body;
    const ratePerContact = (category === 'MARKETING') ? 0.9 : 0.25;
    const totalAmount = Math.round(contactCount * ratePerContact * 100) / 100;

    res.json({
      success: true,
      data: {
        contactCount,
        headerType,
        category,
        ratePerContact,
        totalAmount,
        currency: 'INR'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ────────────────────────────────────────
// POST /api/user/campaigns/create-order — Razorpay order
// ────────────────────────────────────────
router.post('/campaigns/create-order', async (req, res) => {
  try {
    const { finalAmount, campaignName, contactCount, headerType, category } = req.body;

    const amountInPaise = Math.round(finalAmount * 100);
    const order = await getRazorpay().orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `campaign_${Date.now()}`,
      notes: { campaignName, contactCount, headerType, category }
    });

    res.json({ success: true, order, paymentDetails: { amount: finalAmount } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ────────────────────────────────────────
// POST /api/user/campaigns/verify-payment
// ────────────────────────────────────────
router.post('/campaigns/verify-payment', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const isDummy = razorpay_payment_id?.startsWith('dummy_');
    let isValid = isDummy;

    if (!isDummy) {
      const body = razorpay_order_id + '|' + razorpay_payment_id;
      const expected = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'wsBV1ts8yJPld9JktATIdOiS')
        .update(body)
        .digest('hex');
      isValid = expected === razorpay_signature;
    }

    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Payment verification failed' });
    }

    res.json({ success: true, message: 'Payment verified', paymentId: razorpay_payment_id });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ────────────────────────────────────────
// POST /api/user/platform-fee/create-order
// ────────────────────────────────────────
router.post('/platform-fee/create-order', async (req, res) => {
  try {
    const order = await getRazorpay().orders.create({
      amount: PLATFORM_FEE * 100, // paise
      currency: 'INR',
      receipt: `platform_fee_${req.user._id}_${Date.now()}`
    });
    res.json({ success: true, order, amount: PLATFORM_FEE });
  } catch (err) {
    console.error("❌ Platform fee order error:", err.message, err.error);
    res.status(500).json({ success: false, message: err.message, detail: err.error });
  }
});

// ────────────────────────────────────────
// POST /api/user/platform-fee/verify
// ────────────────────────────────────────
router.post('/platform-fee/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'wsBV1ts8yJPld9JktATIdOiS')
      .update(body)
      .digest('hex');

    if (expected !== razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Payment verification failed' });
    }

    // Mark user as platform fee paid
    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        platformFeePaid: true,
        platformFeePaymentId: razorpay_payment_id,
        platformFeePaidAt: new Date()
      },
      { new: true }
    ).select('-password');

    res.json({ success: true, message: 'Platform fee paid successfully', user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ────────────────────────────────────────
// Update free messages sent count
// POST /api/user/free-messages/update
// ────────────────────────────────────────
router.post('/free-messages/update', async (req, res) => {
  try {
    const { count } = req.body;
    const user = await User.findById(req.user._id);
    user.freeMessagesSent = (user.freeMessagesSent || 0) + (count || 0);
    if (user.freeMessagesSent >= 25) {
      user.freeMessagesUsed = true;
    }
    await user.save();
    res.json({
      success: true,
      freeMessagesSent: user.freeMessagesSent,
      freeMessagesUsed: user.freeMessagesUsed
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ────────────────────────────────────────
// SAVED CONTACTS
// ────────────────────────────────────────

// GET /api/user/contacts
router.get('/contacts', async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('savedContacts');
    res.json({ success: true, data: user.savedContacts || [] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/user/contacts — add single contact
router.post('/contacts', async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ success: false, message: 'Name and phone required' });
    }

    const user = await User.findById(req.user._id);
    const exists = user.savedContacts.find(c => c.phone === phone);
    if (exists) {
      return res.status(400).json({ success: false, message: 'Contact already saved' });
    }

    user.savedContacts.push({ name, phone });
    await user.save();

    res.json({ success: true, message: 'Contact saved', data: user.savedContacts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/user/contacts/:phone
router.delete('/contacts/:phone', async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    user.savedContacts = user.savedContacts.filter(c => c.phone !== req.params.phone);
    await user.save();
    res.json({ success: true, message: 'Contact deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ────────────────────────────────────────
// Webhook status update
// POST /api/user/campaigns/update-status
// ────────────────────────────────────────
router.post('/campaigns/update-status', async (req, res) => {
  // Proxy to existing geekychat update-status endpoint
  try {
    const axios = require('axios');
    const response = await axios.post('https://geekychat.in/api/campaigns/update-status');
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ── GET /api/user/campaigns/:id/status — frontend polls this ────────────────
router.get('/campaigns/:id/status', async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      _id:    req.params.id,
      userId: req.user._id
    });

    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Campaign not found' });
    }

    const all       = campaign.messageDetails || [];
    const sent      = all.filter(m => ['sent','delivered','read'].includes(m.status)).length;
    const failed    = all.filter(m => m.status === 'failed').length;
    const delivered = all.filter(m => ['delivered','read'].includes(m.status)).length;
    const read      = all.filter(m => m.status === 'read').length;

    res.json({
      success: true,
      data: {
        status:         campaign.status,
        messageDetails: all,
        stats: {
          total:     all.length,
          sent,
          failed,
          delivered,
          read
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
