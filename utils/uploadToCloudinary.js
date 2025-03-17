const cloudinary = require('../config/cloudinaryConfig');
const fs = require('fs');

/**
 * Uploads a file to Cloudinary
 * @param {string} filePath - Path to the file
 * @param {string} folder - Folder name in Cloudinary
 * @param {string} [resourceType='image'] - Resource type ('image' or 'video')
 * @returns {Promise<{url: string, public_id: string}>}
 */
const uploadToCloudinary = async (filePath, folder, resourceType = 'image') => {
  try {
    // Validate resource type
    if (!['image', 'video', 'raw', 'auto'].includes(resourceType)) {
      throw new Error(`Invalid resource type: ${resourceType}. Must be 'image', 'video', 'raw', or 'auto'.`);
    }

    console.log(`Uploading ${resourceType} to Cloudinary folder: ${folder}`);
    
    const result = await cloudinary.uploader.upload(filePath, {
      folder: folder,
      resource_type: resourceType,
    });
    
    // Clean up the local file after successful upload
    try {
      fs.unlinkSync(filePath);
      console.log(`Successfully deleted temporary file: ${filePath}`);
    } catch (unlinkError) {
      console.warn(`Warning: Could not delete temporary file ${filePath}:`, unlinkError.message);
    }
    
    return {
      url: result.secure_url,
      public_id: result.public_id,
      resource_type: result.resource_type,
      format: result.format,
      width: result.width,
      height: result.height,
      duration: result.duration, // Only for videos
    };
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    
    // Try to clean up the temporary file even if upload failed
    try {
      fs.unlinkSync(filePath);
    } catch (unlinkError) {
      console.warn(`Could not delete temporary file after failed upload: ${filePath}`);
    }
    
    throw new Error(`Failed to upload ${resourceType} to Cloudinary: ${error.message}`);
  }
};

module.exports = uploadToCloudinary;