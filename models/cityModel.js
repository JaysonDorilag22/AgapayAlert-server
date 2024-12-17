const mongoose = require('mongoose');

const citySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  policeStations: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PoliceStation',
    },
  ],
  image: {
    url: {
      type: String,
      required: true,
    },
    public_id: {
      type: String,
      required: true,
    },
  },
});

module.exports = mongoose.model('City', citySchema);