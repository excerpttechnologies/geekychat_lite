const mongoose = require('mongoose');

const templateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  // Meta template ID (after submission to WhatsApp)
  metaTemplateId: {
    type: String,
    default: ''
  },
  category: {
    type: String,
    enum: ['MARKETING', 'UTILITY', 'AUTHENTICATION'],
    default: 'MARKETING'
  },
  headerType: {
    type: String,
    enum: ['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'NONE'],
    default: 'TEXT'
  },
  headerText: {
    type: String,
    default: ''
  },
  bodyText: {
    type: String,
    required: true
  },
  footerText: {
    type: String,
    default: ''
  },
  buttons: [{
    type: { type: String },
    text: String,
    phone_number: String,
    url: String
  }],
  variables: [String], // e.g. ['{{1}}', '{{2}}']
  // Status from Meta
  status: {
    type: String,
    enum: ['draft', 'pending', 'approved', 'rejected'],
    default: 'draft'
  },
  // Which users this template is assigned to
  assignedTo: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MiniUser'
  }],
  // Created by admin
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MiniUser',
    required: true
  },
  language: {
    type: String,
    default: 'en_US'
  }
}, { timestamps: true });

module.exports = mongoose.model('MiniTemplate', templateSchema);
