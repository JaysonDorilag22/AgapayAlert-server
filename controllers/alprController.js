const ALPR = require('../models/alprModel');
const Report = require('../models/reportModel');
const asyncHandler = require('express-async-handler');
const statusCodes = require('../constants/statusCodes');
const axios = require('axios');
const cloudinary = require('../config/cloudinaryConfig');
const dotenv = require('dotenv');
const FormData = require('form-data');
const fs = require('fs');
dotenv.config();

// Scan license plate from image
exports.scanPlate = asyncHandler(async (req, res) => {
  try {
    const { reportId } = req.body;

    if (!req.file) {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: 'No image provided'
      });
    }

    // Image validation
    const allowedTypes = ['image/jpeg', 'image/png'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: 'Invalid file type. Only JPEG and PNG allowed'
      });
    }

    // Call PlateRecognizer API with additional parameters
    const formData = new FormData();
    formData.append('upload', fs.createReadStream(req.file.path));
    formData.append('mmc', 'true'); // Enable make, model, color detection
    formData.append('box_vehicles', 'true'); // Enable vehicle box detection
    
    const response = await axios.post('https://api.platerecognizer.com/v1/plate-reader/', 
      formData,
      {
        headers: {
          'Authorization': `Token ${process.env.ALPR_TOKEN}`,
          ...formData.getHeaders()
        }
      }
    );

    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'alpr_images'
    });

    // Clean up temp file
    fs.unlinkSync(req.file.path);

    const plates = response.data.results;
    if (!plates || plates.length === 0) {
      await cloudinary.uploader.destroy(result.public_id);
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: 'No license plates detected'
      });
    }

    // Create ALPR records for each detected plate
    const alprRecords = await Promise.all(plates.map(async plateData => {
      return await ALPR.create({
        plateNumber: plateData.plate,
        linkedReport: reportId || null,
        image: {
          url: result.secure_url,
          public_id: result.public_id
        },
        scanResults: {
          confidence: plateData.score,
          box: {
            xMin: plateData.box.xmin,
            yMin: plateData.box.ymin,
            xMax: plateData.box.xmax,
            yMax: plateData.box.ymax
          },
          vehicle: {
            type: plateData.vehicle?.type || '',
            score: plateData.vehicle?.score || 0,
            box: plateData.vehicle?.box || null,
            color: {
              primary: plateData.vehicle?.color?.[0] || '',
              secondary: plateData.vehicle?.color?.[1] || ''
            },
            make: plateData.vehicle?.make?.[0]?.name || '',
            makeConfidence: plateData.vehicle?.make?.[0]?.score || 0,
            model: plateData.vehicle?.model?.[0]?.name || '',
            modelConfidence: plateData.vehicle?.model?.[0]?.score || 0
          },
          region: {
            code: plateData.region?.code || '',
            score: plateData.region?.score || 0
          }
        },
        candidates: plateData.candidates || [],
        source: 'image'
      });
    }));

     // Log saved database records
     console.log('\n=== Saved ALPR Records ===\n', 
      JSON.stringify(alprRecords, null, 2)
    );

    res.status(statusCodes.CREATED).json({
      success: true,
      data: {
        totalPlates: alprRecords.length,
        records: alprRecords,
        imageUrl: result.secure_url
      }
    });

  } catch (error) {
    console.error('ALPR Error:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error processing license plate',
      error: error.message
    });
  }
});
  
// Get all scans with pagination and filters
exports.getAllScans = asyncHandler(async (req, res) => {
  try {
    const { page = 1, limit = 10, reportId, plateNumber } = req.query;
    
    let query = {};
    if (reportId) query.linkedReport = reportId;
    if (plateNumber) query.plateNumber = { $regex: plateNumber, $options: 'i' };

    const scans = await ALPR.find(query)
      .populate('linkedReport', 'type status')
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await ALPR.countDocuments(query);

    res.status(statusCodes.OK).json({
      success: true,
      data: {
        scans,
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        total
      }
    });

  } catch (error) {
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error retrieving scans',
      error: error.message
    });
  }
});

// Get scan by ID
exports.getScanById = asyncHandler(async (req, res) => {
  try {
    const scan = await ALPR.findById(req.params.id)
      .populate('linkedReport', 'type status personInvolved');
    
    if (!scan) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: 'Scan not found'
      });
    }

    res.status(statusCodes.OK).json({
      success: true,
      data: scan
    });

  } catch (error) {
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error retrieving scan',
      error: error.message
    });
  }
});

// Link scan to report
exports.linkToReport = asyncHandler(async (req, res) => {
  try {
    const { scanId, reportId } = req.params;

    const [scan, report] = await Promise.all([
      ALPR.findById(scanId),
      Report.findById(reportId)
    ]);

    if (!scan || !report) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: 'Scan or report not found'
      });
    }

    scan.linkedReport = reportId;
    await scan.save();

    res.status(statusCodes.OK).json({
      success: true,
      msg: 'Scan linked to report successfully',
      data: scan
    });

  } catch (error) {
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error linking scan to report',
      error: error.message
    });
  }
});

// Delete scan
exports.deleteScan = asyncHandler(async (req, res) => {
  try {
    const scan = await ALPR.findById(req.params.id);
    
    if (!scan) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: 'Scan not found'
      });
    }

    if (scan.image.public_id) {
      await cloudinary.uploader.destroy(scan.image.public_id);
    }
    
    await scan.deleteOne();

    res.status(statusCodes.OK).json({
      success: true,
      msg: 'Scan deleted successfully'
    });

  } catch (error) {
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error deleting scan',
      error: error.message
    });
  }
});

exports.testScan = asyncHandler(async (req, res) => {
  try {
    if (!req.file) {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: 'No image provided'
      });
    }

    // Image validation
    const allowedTypes = ['image/jpeg', 'image/png'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: 'Invalid file type. Only JPEG and PNG allowed'
      });
    }

    // Call PlateRecognizer API with additional parameters
    const formData = new FormData();
    formData.append('upload', fs.createReadStream(req.file.path));
    formData.append('mmc', 'true'); // Enable make, model, color detection
    formData.append('box_vehicles', 'true'); // Enable vehicle box detection
    
    const response = await axios.post('https://api.platerecognizer.com/v1/plate-reader/', 
      formData,
      {
        headers: {
          'Authorization': `Token ${process.env.ALPR_TOKEN}`,
          ...formData.getHeaders()
        }
      }
    );

    // Clean up temp file
    fs.unlinkSync(req.file.path);

    // Log and return raw API response
    console.log('\n=== Raw PlateRecognizer API Response ===\n', 
      JSON.stringify(response.data, null, 2)
    );

    res.status(statusCodes.OK).json({
      success: true,
      data: response.data
    });

  } catch (error) {
    console.error('ALPR Test Error:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: 'Error testing license plate scan',
      error: error.message
    });
  }
});

module.exports = exports;