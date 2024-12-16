const cloudinary = require('../config/cloudinaryConfig');

const uploadToCloudinary = async (filePath, folder) => {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder: folder,
    });
    return {
      url: result.secure_url,
      public_id: result.public_id,
    };
  } catch (error) {
    throw new Error('Failed to upload image to Cloudinary');
  }
};

module.exports = uploadToCloudinary;