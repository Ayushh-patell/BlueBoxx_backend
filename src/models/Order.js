// src/models/Order.js  (shared collection)
import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema({
  name: String,
  quantity: Number,
  priceCents: Number,
  size: String
}, { _id: false, strict: false });

const addressSchema = new mongoose.Schema({
  streetAddress: [String],
  city: String,
  province: String,
  postalCode: String,
  country: String
}, { _id: false, strict: false });

const locationSchema = new mongoose.Schema({
  name: String,
  phone: String,
  address: addressSchema
}, { _id: false, strict: false });

const orderSchema = new mongoose.Schema({
  site: { type: mongoose.Schema.Types.ObjectId, index: true },
  userEmail: String,

  fulfillmentType: { type: String, enum: ['delivery', 'pickup'], index: true },

  items: [orderItemSchema],

  totalCents: Number,
  taxCents: Number,
  tipCents: Number,
  deliveryFeeCents: Number,
  deliveryFeeRestaurantCents: Number,

  notes: String,

  externalId: String,

  // aggregator/partner fields (keep optional)
  uberDeliveryId: String,
  uberTrackingUrl: String,
  uberStatus: String,

  status: { type: String, index: true, enum: ['new', 'processing', 'fulfilled', 'cancelled', 'accepted', 'prepared', 'dispatched'] }, // e.g. 'created', 'pending', etc.

  pickup: { location: locationSchema },
  dropoff: {
    name: String,
    phone: String,
    address: addressSchema
  },

  meta: { type: Object }
}, {
  collection: 'orders',
  strict: false,      // <- allow extra fields from the other app
  versionKey: false,  // don't write __v into shared docs
  timestamps: true    // aligns with your stored createdAt/updatedAt
});

// Suggested index for date-range dashboards (confirm with getIndexes())
orderSchema.index({ site: 1, createdAt: 1 });

export default mongoose.models.Order || mongoose.model('Order', orderSchema);
