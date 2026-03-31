const express  = require('express');
const router   = express.Router();
const Campaign = require('../models/Campaign');
const axios    = require('axios');

const STATUS_PRIORITY = { read: 5, delivered: 4, failed: 3, sent: 2, pending: 1 };

// ── GET /webhook — Meta verification ─────────────────────────────────────────
router.get('/', (req, res) => {
  const VERIFY_TOKEN = process.env.WA_WEBHOOK_VERIFY_TOKEN || 'demo';
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('🔔 Webhook verification attempt — token:', token);

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    return res.status(200).send(challenge);
  }
  return res.status(403).json({ error: 'Verification failed' });
});

// ── POST /webhook — receive status updates from Meta ─────────────────────────
router.post('/', async (req, res) => {
  // Always respond 200 immediately — Meta retries if it doesn't get this fast
  res.status(200).send('EVENT_RECEIVED');

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    console.log('📨 Webhook received:', JSON.stringify(body, null, 2));

    // ── Step 1: Forward to geekychat.in so main platform also updates ────────
    try {
      await axios.post('https://geekychat.in/webhook', body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000,
      });
      console.log('✅ Forwarded webhook to geekychat.in');
    } catch (fwdErr) {
      // Don't block — just log if forward fails
      console.error('⚠️ Failed to forward to geekychat.in:', fwdErr.message);
    }

    // ── Step 2: Process for mini platform's own DB ────────────────────────────
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;
        if (!value) continue;

        for (const statusUpdate of value.statuses || []) {
          const messageId = statusUpdate.id;
          const newStatus = statusUpdate.status; // sent/delivered/read/failed
          const timestamp = statusUpdate.timestamp;
          const errorData = statusUpdate.errors?.[0];

          console.log(`📊 Status update: ${messageId} → ${newStatus}`);

          // Find campaign in MINI platform DB
          const campaign = await Campaign.findOne({
            'messageDetails.messageId': messageId
          });

          if (!campaign) {
            console.log(`⚠️ messageId ${messageId} not found in mini DB`);
            continue;
          }

          let updated = false;

          campaign.messageDetails = campaign.messageDetails.map(msg => {
            if (msg.messageId !== messageId) return msg;

            const existingRank = STATUS_PRIORITY[msg.status] ?? -1;
            const newRank      = STATUS_PRIORITY[newStatus]  ?? -1;

            // Only upgrade status — never downgrade
            if (newRank <= existingRank) return msg;

            updated = true;
            const updatedMsg = { ...msg.toObject(), status: newStatus };

            if (newStatus === 'delivered') {
              updatedMsg.deliveredAt = new Date(parseInt(timestamp) * 1000);
            }
            if (newStatus === 'read') {
              updatedMsg.readAt = new Date(parseInt(timestamp) * 1000);
            }
            if (newStatus === 'failed' && errorData) {
              updatedMsg.error = errorData.message || `Error code: ${errorData.code}`;
            }

            return updatedMsg;
          });

          if (!updated) {
            console.log(`⏭️ Status ${newStatus} not higher than current for ${messageId}`);
            continue;
          }

          // Recalculate campaign stats
          const all       = campaign.messageDetails;
          const sent      = all.filter(m => ['sent','delivered','read'].includes(m.status)).length;
          const failed    = all.filter(m => m.status === 'failed').length;
          const delivered = all.filter(m => ['delivered','read'].includes(m.status)).length;
          const read      = all.filter(m => m.status === 'read').length;
          const total     = all.length;

          campaign.stats = {
            ...campaign.stats,
            successfulMessages: sent,
            failedMessages:     failed,
            deliveredMessages:  delivered,
            readMessages:       read,
            successRate:        total > 0 ? (sent / total) * 100 : 0,
          };

          await campaign.save();
          console.log(`✅ Mini DB updated: campaign ${campaign._id} → ${newStatus}`);
        }
      }
    }
  } catch (err) {
    console.error('❌ Webhook processing error:', err.message);
  }
});

module.exports = router;