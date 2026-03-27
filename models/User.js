const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    trim: true,
    default: ''
  },
  role: {
    type: String,
    enum: ['admin', 'user'],
    default: 'user'
  },
  isBlocked: {
    type: Boolean,
    default: false
  },
  // Assigned WhatsApp phone number by admin
  assignedPhone: {
    phoneNumberId: { type: String, default: '' },
    phoneNumber:   { type: String, default: '' },
    displayName:   { type: String, default: '' },
    isActive:      { type: Boolean, default: true }
  },
  // Payment status
  platformFeePaid: {
    type: Boolean,
    default: false
  },
  platformFeePaymentId: {
    type: String,
    default: ''
  },
  platformFeePaidAt: {
    type: Date,
    default: null
  },
  // Free messages tracking (first 25 free)
  freeMessagesSent: {
    type: Number,
    default: 0
  },
  freeMessagesUsed: {
    type: Boolean,
    default: false
  },
  // Saved contacts
  savedContacts: [{
    name:  { type: String, required: true },
    phone: { type: String, required: true }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Hash password before save
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('MiniUser', userSchema);
