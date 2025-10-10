// src/models/Site.js
import mongoose from 'mongoose';

const siteSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    name: String
  },
  {
    collection: 'sites',
    strict: false,
    versionKey: false,
    timestamps: true
  }
);

export default mongoose.models.Site || mongoose.model('Site', siteSchema);