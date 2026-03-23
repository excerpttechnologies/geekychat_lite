const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Template = require('../models/Template');
const Campaign = require('../models/Campaign');
const { protect, adminOnly } = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const axios  = require('axios');
const FormData = require('form-data');

// ════════════════════════════════════════════════
// MULTER CONFIG
// ════════════════════════════════════════════════
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|mp4|pdf|doc|docx|txt/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    if (ext) cb(null, true);
    else cb(new Error('File type not allowed'));
  }
});

const ACCESS_TOKEN        = 'EAAdzxxobLG4BPU8Lei8DhhuZCjlCthpNQ55ok3LGlpY1PSIzXsOnTrEje2BvKUZCjFPOWlTtJg1TezXPgjp7NrCPN5Nzv6x2BOF7lMQml80v4NNIIWFEZAy5H7ZBZAgk7ZBku0y7QIBIwMsQ9ZCVe6JpbAa9wSz1dHb7xeDJTw7msm7AoxF1YMumg01P1LGBAZDZD';
const BUSINESS_ACCOUNT_ID = '1377314883331309';

// Apply auth to all admin routes
router.use(protect, adminOnly);

// ════════════════════════════════════════════════
// USER MANAGEMENT
// ════════════════════════════════════════════════

router.get('/users', async (req, res) => {
  try {
    const users = await User.find({ role: 'user' }).select('-password').sort({ createdAt: -1 });
    const usersWithStats = await Promise.all(users.map(async (u) => {
      const campaigns = await Campaign.find({ userId: u._id });
      const totalSent     = campaigns.reduce((s, c) => s + (c.stats?.successfulMessages || 0), 0);
      const totalFailed   = campaigns.reduce((s, c) => s + (c.stats?.failedMessages || 0), 0);
      const totalContacts = campaigns.reduce((s, c) => s + (c.stats?.totalContacts || 0), 0);
      return { ...u.toObject(), stats: { totalCampaigns: campaigns.length, totalContacts, totalSent, totalFailed,
        successRate: totalContacts > 0 ? ((totalSent / totalContacts) * 100).toFixed(1) : '0.0' } };
    }));
    res.json({ success: true, data: usersWithStats });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/users', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password) return res.status(400).json({ success: false, message: 'Name, email and password are required' });
    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(400).json({ success: false, message: 'Email already exists' });
    const user = new User({ name, email: email.toLowerCase(), password, phone: phone || '', role: 'user' });
    await user.save();
    const saved = await User.findById(user._id).select('-password');
    res.status(201).json({ success: true, message: 'User created', data: saved });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/users/:id', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    const updateData = {};
    if (name)     updateData.name  = name;
    if (email)    updateData.email = email.toLowerCase();
    if (phone)    updateData.phone = phone;
    if (password) updateData.password = await bcrypt.hash(password, 12);
    const user = await User.findByIdAndUpdate(req.params.id, updateData, { new: true }).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, message: 'User updated', data: user });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.patch('/users/:id/block', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    user.isBlocked = !user.isBlocked;
    await user.save();
    res.json({ success: true, message: user.isBlocked ? 'User blocked' : 'User unblocked', isBlocked: user.isBlocked });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/users/:id', async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'User deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.patch('/users/:id/assign-phone', async (req, res) => {
  try {
    const { phoneNumberId, phoneNumber, displayName } = req.body;
    if (!phoneNumberId || !phoneNumber) return res.status(400).json({ success: false, message: 'phoneNumberId and phoneNumber required' });
    const user = await User.findByIdAndUpdate(req.params.id,
      { assignedPhone: { phoneNumberId, phoneNumber, displayName: displayName || '', isActive: true } },
      { new: true }).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, message: 'Phone number assigned', data: user });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ════════════════════════════════════════════════
// TEMPLATE MANAGEMENT
// ════════════════════════════════════════════════

// ── Step 1: Get upload session from Meta Resumable Upload API ─────────────────
// Step 2: Upload file bytes → get handle starting with "4:..."
// Step 3: Use that handle in header_handle for template creation
// Uses phoneNumberId as the app-scoped account (same token, correct scope)
const uploadMediaForTemplate = async (filePath, fileName, mimeType) => {
  const fileBuffer = fs.readFileSync(filePath);
  const fileSize   = fs.statSync(filePath).size;

  console.log('=== META RESUMABLE UPLOAD ===');
  console.log('File:', fileName, '| Size:', fileSize, '| MIME:', mimeType);

  // Step 1: Start upload session using BUSINESS_ACCOUNT_ID
  let sessionId;
  try {
    const sessionRes = await axios.post(
      `https://graph.facebook.com/v21.0/app/uploads`,
      null,
      {
        params: {
          file_name:    fileName,
          file_length:  fileSize,
          file_type:    mimeType,
          access_token: ACCESS_TOKEN,
        },
      }
    );
    sessionId = sessionRes.data.id;
    console.log('Upload session ID:', sessionId);
  } catch (err) {
    const e = err?.response?.data?.error || err.message;
    console.error('Session error:', JSON.stringify(e));
    throw new Error(`Upload session failed: ${JSON.stringify(e)}`);
  }

  // Step 2: Upload file bytes to get handle
  let handle;
  try {
    const uploadRes = await axios.post(
      `https://graph.facebook.com/v21.0/${sessionId}`,
      fileBuffer,
      {
        headers: {
          'Authorization':  `OAuth ${ACCESS_TOKEN}`,
          'file_offset':    '0',
          'Content-Type':   'application/octet-stream',
          'Content-Length': fileSize,
        },
        maxBodyLength:    Infinity,
        maxContentLength: Infinity,
      }
    );
    handle = uploadRes.data.h;
    console.log('Upload result:', uploadRes.data);
    if (!handle) throw new Error(`No handle in response: ${JSON.stringify(uploadRes.data)}`);
    console.log('Got handle:', handle);
  } catch (err) {
    const e = err?.response?.data?.error || err.message;
    console.error('Upload error:', JSON.stringify(e));
    throw new Error(`File upload failed: ${JSON.stringify(e)}`);
  }

  return handle;
};

// ── Create template in Meta ──────────────────────────────────────────────────
const createMetaTemplate = async (templateData, mediaId) => {
  const components = [];

  if (templateData.headerType === 'TEXT' && templateData.headerText) {
    components.push({ type: 'HEADER', format: 'TEXT', text: templateData.headerText });
  } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(templateData.headerType) && mediaId) {
    components.push({
      type: 'HEADER',
      format: templateData.headerType,
      example: { header_handle: [mediaId] },
    });
  }

  const bodyComponent = { type: 'BODY', text: templateData.bodyText };
  const varMatches = templateData.bodyText.match(/\{\{(\d+)\}\}/g);
  if (varMatches?.length) {
    bodyComponent.example = {
      body_text: [templateData.bodyText.replace(/\{\{(\d+)\}\}/g, (_, n) => `sample_${n}`)],
    };
  }
  components.push(bodyComponent);

  if (templateData.footerText) {
    components.push({ type: 'FOOTER', text: templateData.footerText });
  }

  const payload = {
    name: templateData.name,
    category: templateData.category,
    language: 'en_US',
    components,
  };

  console.log('Creating Meta template payload:', JSON.stringify(payload, null, 2));

  try {
    const res = await axios.post(
      `https://graph.facebook.com/v23.0/${BUSINESS_ACCOUNT_ID}/message_templates`,
      payload,
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
    );
    console.log('Meta template created:', res.data);
    return res.data;
  } catch (err) {
    const errData = err?.response?.data?.error || err?.response?.data || err.message;
    console.error('Meta template creation error:', JSON.stringify(errData));
    throw new Error(`Meta API error: ${JSON.stringify(errData)}`);
  }
};

// POST /api/admin/create-template
// Receives FormData with file + phoneNumberId from frontend
router.post('/create-template', upload.single('file'), async (req, res) => {
  try {
    const {
      name, category, headerType, headerText,
      bodyText, footerText, status,
      phoneNumberId  // ← sent from frontend (AdminTemplates.tsx)
    } = req.body;

    const assignedTo = JSON.parse(req.body.assignedTo || '[]');
    const variables  = JSON.parse(req.body.variables  || '[]');

    console.log('=== CREATE TEMPLATE REQUEST ===');
    console.log('Name:', name, '| HeaderType:', headerType, '| PhoneNumberId:', phoneNumberId);

    if (!name || !bodyText) {
      return res.status(400).json({ success: false, message: 'Name and body text required' });
    }

    if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType) && !phoneNumberId) {
      return res.status(400).json({ success: false, message: 'phoneNumberId is required for media templates' });
    }

    // Check duplicate
    const exists = await Template.findOne({ name: name.toLowerCase().trim() });
    if (exists) return res.status(400).json({ success: false, message: 'Template name already exists' });

    let mediaId  = null;
    let mediaUrl = '';

    // ── Upload to WhatsApp if media header ──────────────────────────────
    if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType) && req.file) {
      try {
        mediaId = await uploadMediaForTemplate(
          req.file.path,
          req.file.originalname,
          req.file.mimetype
        );
        const HOST = process.env.BASE_URL || 'http://localhost:5000';
        mediaUrl = `${HOST}/uploads/${req.file.filename}`;
        console.log('Media ID:', mediaId, '| Local URL:', mediaUrl);
      } catch (uploadErr) {
        return res.status(400).json({ success: false, message: uploadErr.message });
      }
    }

    // ── Create in Meta ──────────────────────────────────────────────────
    let metaTemplateId = '';
    try {
      const metaRes = await createMetaTemplate(
        { name: name.toLowerCase().trim(), category, headerType, headerText, bodyText, footerText },
        mediaId
      );
      metaTemplateId = metaRes.id || '';
    } catch (metaErr) {
      return res.status(400).json({ success: false, message: metaErr.message });
    }

    // ── Save to DB ──────────────────────────────────────────────────────
    const template = new Template({
      name: name.toLowerCase().trim(),
      category: category || 'MARKETING',
      headerType: headerType || 'TEXT',
      headerText: headerText || '',
      bodyText,
      footerText: footerText || '',
      variables,
      assignedTo,
      createdBy: req.user._id,
      metaTemplateId,
      mediaUrl,
      status: status || 'pending',
      language: 'en_US',
    });

    await template.save();
    const saved = await Template.findById(template._id)
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name');

    res.status(201).json({ success: true, message: 'Template created successfully', data: saved });

  } catch (err) {
    console.error('create-template error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/admin/templates
router.get('/templates', async (req, res) => {
  try {
    const templates = await Template.find()
      .populate('assignedTo', 'name email')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: templates });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// PUT /api/admin/templates/:id
router.put('/templates/:id', async (req, res) => {
  try {
    const { name, category, headerType, headerText, bodyText, footerText, buttons, variables, assignedTo, status } = req.body;
    const updateData = {};
    if (name)                     updateData.name       = name.toLowerCase().trim();
    if (category)                 updateData.category   = category;
    if (headerType)               updateData.headerType = headerType;
    if (headerText !== undefined) updateData.headerText = headerText;
    if (bodyText)                 updateData.bodyText   = bodyText;
    if (footerText !== undefined) updateData.footerText = footerText;
    if (buttons)                  updateData.buttons    = buttons;
    if (variables)                updateData.variables  = variables;
    if (assignedTo)               updateData.assignedTo = assignedTo;
    if (status)                   updateData.status     = status;
    const template = await Template.findByIdAndUpdate(req.params.id, updateData, { new: true })
      .populate('assignedTo', 'name email').populate('createdBy', 'name');
    if (!template) return res.status(404).json({ success: false, message: 'Template not found' });
    res.json({ success: true, message: 'Template updated', data: template });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.patch('/templates/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const template = await Template.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!template) return res.status(404).json({ success: false, message: 'Template not found' });
    res.json({ success: true, message: `Template set to ${status}`, data: template });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/templates/:id', async (req, res) => {
  try {
    await Template.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Template deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.patch('/templates/:id/assign', async (req, res) => {
  try {
    const { userIds } = req.body;
    const template = await Template.findByIdAndUpdate(req.params.id, { assignedTo: userIds }, { new: true })
      .populate('assignedTo', 'name email');
    if (!template) return res.status(404).json({ success: false, message: 'Template not found' });
    res.json({ success: true, message: 'Template assigned', data: template });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ════════════════════════════════════════════════
// ADMIN DASHBOARD STATS
// ════════════════════════════════════════════════

router.get('/dashboard', async (req, res) => {
  try {
    const totalUsers     = await User.countDocuments({ role: 'user' });
    const blockedUsers   = await User.countDocuments({ role: 'user', isBlocked: true });
    const totalTemplates = await Template.countDocuments();
    const totalCampaigns = await Campaign.countDocuments();
    const allCampaigns   = await Campaign.find().select('stats');
    const totalSent      = allCampaigns.reduce((s, c) => s + (c.stats?.successfulMessages || 0), 0);
    const totalFailed    = allCampaigns.reduce((s, c) => s + (c.stats?.failedMessages || 0), 0);
    const totalContacts  = allCampaigns.reduce((s, c) => s + (c.stats?.totalContacts || 0), 0);
    const recentUsers    = await User.find({ role: 'user' }).select('-password').sort({ createdAt: -1 }).limit(5);
    const recentCampaigns= await Campaign.find().populate('userId', 'name email').sort({ createdAt: -1 }).limit(5);
    res.json({ success: true, data: { stats: { totalUsers, blockedUsers, activeUsers: totalUsers - blockedUsers,
      totalTemplates, totalCampaigns, totalSent, totalFailed, totalContacts,
      successRate: totalContacts > 0 ? ((totalSent / totalContacts) * 100).toFixed(1) : '0.0' },
      recentUsers, recentCampaigns } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/users/:id/detail', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const campaigns = await Campaign.find({ userId: req.params.id }).sort({ createdAt: -1 });
    const stats = {
      totalCampaigns:  campaigns.length,
      totalContacts:   campaigns.reduce((s, c) => s + (c.stats?.totalContacts || 0), 0),
      totalSent:       campaigns.reduce((s, c) => s + (c.stats?.successfulMessages || 0), 0),
      totalFailed:     campaigns.reduce((s, c) => s + (c.stats?.failedMessages || 0), 0),
      totalDelivered:  campaigns.reduce((s, c) => s + (c.stats?.deliveredMessages || 0), 0),
      totalRead:       campaigns.reduce((s, c) => s + (c.stats?.readMessages || 0), 0),
    };
    stats.successRate = stats.totalContacts > 0
      ? ((stats.totalSent / stats.totalContacts) * 100).toFixed(1) : '0.0';
    res.json({ success: true, data: { user, stats, campaigns } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;