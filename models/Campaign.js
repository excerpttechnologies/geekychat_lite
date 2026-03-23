const mongoose = require('mongoose');

const messageDetailSchema = new mongoose.Schema({
  phoneNumber: String,
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'read', 'failed'],
    default: 'pending'
  },
  messageId: { type: String, default: '' },
  error:      { type: String, default: '' },
  sentAt:     { type: Date, default: Date.now },
  deliveredAt:{ type: Date },
  readAt:     { type: Date }
}, { _id: false });

const campaignSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MiniUser',
    required: true
  },
  campaignName:  { type: String, required: true },
  templateId:    { type: mongoose.Schema.Types.ObjectId, ref: 'MiniTemplate' },
  templateName:  { type: String },
  phoneNumberId: { type: String, required: true },
  headerType:    { type: String, default: 'TEXT' },
  category:      { type: String, default: 'MARKETING' },
  contacts:      [String],
  messageDetails:[messageDetailSchema],
  stats: {
    totalContacts:      { type: Number, default: 0 },
    successfulMessages: { type: Number, default: 0 },
    failedMessages:     { type: Number, default: 0 },
    deliveredMessages:  { type: Number, default: 0 },
    readMessages:       { type: Number, default: 0 },
    successRate:        { type: Number, default: 0 }
  },
  // Payment info
  paymentId:     { type: String, default: '' },
  amountPaid:    { type: Number, default: 0 },
  isFreeDemo:    { type: Boolean, default: false },
  status: {
    type: String,
    enum: ['pending', 'sending', 'completed', 'failed', 'partial'],
    default: 'pending'
  },
  batchNumber:    { type: Number },
  parentCampaignId: { type: String, default: '' },
  campaignId:     { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('MiniCampaign', campaignSchema);
