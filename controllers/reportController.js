const Report = require("../models/reportModel");
const Notification = require("../models/notificationModel");
const User = require("../models/userModel");
const PoliceStation = require("../models/policeStationModel");
const asyncHandler = require("express-async-handler");
const statusCodes = require("../constants/statusCodes");
const errorMessages = require("../constants/errorMessages");
const uploadToCloudinary = require("../utils/uploadToCloudinary");
const { notifyPoliceStation } = require("../utils/notificationUtils");
const cloudinary = require("cloudinary").v2;
const { getCoordinatesFromAddress } = require("../utils/geocoding");
const { sendOneSignalNotification } = require("../utils/notificationUtils");
const { isLastSeenMoreThan24Hours } = require("../utils/isLastSeenMoreThan24Hours");
const { getIO, SOCKET_EVENTS } = require("../utils/socketUtils");

// Helper function to find police station
const findPoliceStation = async (selectedId, coordinates) => {
  if (selectedId) {
    const selected = await PoliceStation.findById(selectedId);
    if (selected) return selected;
  }

  // Find nearest within 5km
  const nearest = await PoliceStation.findOne({
    location: {
      $near: {
        $geometry: {
          type: "Point",
          coordinates,
        },
        $maxDistance: 5000,
      },
    },
  });

  // If no station within 5km, find absolute nearest
  if (!nearest) {
    return await PoliceStation.findOne({
      location: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates,
          },
        },
      },
    });
  }

  return nearest;
};

// Create a new report
exports.createReport = asyncHandler(async (req, res) => {
  try {
    let { type, personInvolved, location, selectedPoliceStation } = req.body;

    // Automatically handle Missing/Absent classification
    if (type === "Missing" || type === "Absent") {
      const timeCheck = isLastSeenMoreThan24Hours(
        personInvolved.lastSeenDate,
        personInvolved.lastSeentime
      );

      // Automatically set type based on hours passed
      type = timeCheck.isMoreThan24Hours ? "Missing" : "Absent";

      // No need to throw error, just inform about the classification
      const message = timeCheck.isMoreThan24Hours
        ? `Case classified as 'Missing Person' since person has been missing for ${timeCheck.hoursPassed} hours.`
        : `Case classified as 'Absent Person' since person has been missing for ${timeCheck.hoursPassed} hours.`;

      console.log("Time check result:", {
        timeCheck,
        assignedType: type,
        message,
      });
    }

    const broadcastConsent = req.body.broadcastConsent === "true";

    // Validate input
    if (
      !type ||
      !personInvolved ||
      !location ||
      typeof broadcastConsent !== "boolean"
    ) {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: "Missing required fields or invalid broadcast consent",
      });
    }

    // Get coordinates from address
    const geoData = await getCoordinatesFromAddress(location.address);
    if (!geoData.success) {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: geoData.message,
      });
    }

    // Handle photo upload
    if (!req.files?.["personInvolved[mostRecentPhoto]"]) {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: "Most recent photo is required",
      });
    }

    const photoFile = req.files["personInvolved[mostRecentPhoto]"][0];
    const photoResult = await uploadToCloudinary(photoFile.path, "reports");

    // Handle additional images
    let additionalImages = [];
    if (req.files?.additionalImages) {
      const uploadPromises = req.files.additionalImages.map((file) =>
        uploadToCloudinary(file.path, "reports")
      );
      const uploadResults = await Promise.all(uploadPromises);
      additionalImages = uploadResults.map((result) => ({
        url: result.url,
        public_id: result.public_id,
      }));
    }

    // Find police station
    let assignedStation = await findPoliceStation(
      selectedPoliceStation,
      geoData.coordinates
    );
    if (!assignedStation) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: "No police stations found in the system",
      });
    }

    // Create report
    const report = new Report({
      reporter: req.user.id,
      type,
      personInvolved: {
        ...personInvolved,
        mostRecentPhoto: {
          url: photoResult.url,
          public_id: photoResult.public_id,
        },
      },
      additionalImages,
      location: {
        type: "Point",
        coordinates: geoData.coordinates,
        address: location.address,
      },
      assignedPoliceStation: assignedStation._id,
      broadcastConsent: broadcastConsent,
      consentUpdateHistory: [
        {
          previousValue: false,
          newValue: broadcastConsent,
          updatedBy: req.user.id,
          date: new Date(),
        },
      ],
    });

    await report.save();

    // Get populated report data for socket emission
    const populatedReport = await Report.findById(report._id)
      .populate("reporter", "firstName lastName")
      .populate("assignedPoliceStation", "name address")
      .select({
        type: 1,
        personInvolved: 1,
        location: 1,
        status: 1,
        createdAt: 1,
      });

    // Emit socket event for new report
    const io = getIO();

    // Emit to police station room
    io.to(`policeStation_${assignedStation._id}`).emit(
      SOCKET_EVENTS.NEW_REPORT,
      {
        report: populatedReport,
        message: `New ${type} report assigned to your station`,
      }
    );

    // Emit to city admin room if exists
    io.to(`city_${location.address.city}`).emit(SOCKET_EVENTS.NEW_REPORT, {
      report: populatedReport,
      message: `New ${type} report in your city`,
    });

    // Handle notifications
    try {
      await notifyPoliceStation(report, assignedStation);

      // Notify reporter
      await Notification.create({
        recipient: req.user.id,
        type: "REPORT_CREATED",
        title: "Report Created",
        message: `Your ${type} report has been created and assigned to ${assignedStation.name}`,
        data: {
          reportId: report._id,
        },
      });
    } catch (notificationError) {
      console.error("Notification failed:", notificationError);
    }

    res.status(statusCodes.CREATED).json({
      success: true,
      msg: "Report created successfully",
      data: {
        report,
        assignedStation,
        assignmentType: selectedPoliceStation
          ? "Manual Selection"
          : "Automatic Assignment",
      },
    });
  } catch (error) {
    console.error("Error in createReport:", error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: "Error creating report",
      error: error.message,
    });
  }
});

//create report v2
// exports.createReport = asyncHandler(async (req, res) => {
//   try {
//     let { type, personInvolved, location, selectedPoliceStation } = req.body;

//     // Automatically handle Missing/Absent classification
//     if (type === "Missing" || type === "Absent") {
//       const timeCheck = isLastSeenMoreThan24Hours(
//         personInvolved.lastSeenDate,
//         personInvolved.lastSeentime
//       );
//       type = timeCheck.isMoreThan24Hours ? "Missing" : "Absent";
//     }

//     const broadcastConsent = req.body.broadcastConsent === "true";

//     // Validate input
//     if (!type || !personInvolved || !location || typeof broadcastConsent !== "boolean") {
//       return res.status(statusCodes.BAD_REQUEST).json({
//         success: false,
//         msg: "Missing required fields or invalid broadcast consent",
//       });
//     }

//     // Get coordinates from address
//     const geoData = await getCoordinatesFromAddress(location.address);
//     if (!geoData.success) {
//       return res.status(statusCodes.BAD_REQUEST).json({
//         success: false,
//         msg: geoData.message,
//       });
//     }

//     // Handle photo upload
//     if (!req.files?.["personInvolved[mostRecentPhoto]"]) {
//       return res.status(statusCodes.BAD_REQUEST).json({
//         success: false,
//         msg: "Most recent photo is required",
//       });
//     }

//     const photoFile = req.files["personInvolved[mostRecentPhoto]"][0];
//     const photoResult = await uploadToCloudinary(photoFile.path, "reports");

//     // Handle additional images
//     let additionalImages = [];
//     if (req.files?.additionalImages) {
//       const uploadPromises = req.files.additionalImages.map((file) =>
//         uploadToCloudinary(file.path, "reports")
//       );
//       const uploadResults = await Promise.all(uploadPromises);
//       additionalImages = uploadResults.map((result) => ({
//         url: result.url,
//         public_id: result.public_id,
//       }));
//     }

//     // Handle video upload
//     let video = null;
//     if (req.files?.video) {
//       const videoFile = req.files.video[0];
//       const videoResult = await uploadToCloudinary(
//         videoFile.path, 
//         "report_videos", 
//         "video"
//       );
//       video = {
//         url: videoResult.url,
//         public_id: videoResult.public_id
//       };
//     }

//     // Find police station
//     let assignedStation = await findPoliceStation(selectedPoliceStation, geoData.coordinates);
//     if (!assignedStation) {
//       return res.status(statusCodes.NOT_FOUND).json({
//         success: false,
//         msg: "No police stations found in the system",
//       });
//     }

//     // Find available officers
//     const availableOfficers = await User.find({
//       policeStation: assignedStation._id,
//       roles: 'police_officer',
//       isOnDuty: true
//     }).populate({
//       path: 'assignedCases',
//       match: { status: { $ne: 'Resolved' } }
//     });

//     // Filter officers with less than 3 active cases
//     const eligibleOfficers = availableOfficers.filter(officer => 
//       officer.assignedCases?.length < 3
//     );

//     // Find nearest officer
//     let nearestOfficer = null;
//     if (eligibleOfficers.length > 0) {
//       nearestOfficer = eligibleOfficers.reduce((nearest, officer) => {
//         if (!officer.location?.coordinates) return nearest;
        
//         const distance = calculateDistance(
//           geoData.coordinates,
//           officer.location.coordinates
//         );

//         if (!nearest || distance < nearest.distance) {
//           return { officer, distance };
//         }
//         return nearest;
//       }, null);
//     }

//     // Create report
//     const report = new Report({
//       reporter: req.user.id,
//       type,
//       personInvolved: {
//         ...personInvolved,
//         mostRecentPhoto: {
//           url: photoResult.url,
//           public_id: photoResult.public_id,
//         },
//       },
//       additionalImages,
//       video,
//       location: {
//         type: "Point",
//         coordinates: geoData.coordinates,
//         address: location.address,
//       },
//       assignedPoliceStation: assignedStation._id,
//       broadcastConsent,
//       consentUpdateHistory: [
//         {
//           previousValue: false,
//           newValue: broadcastConsent,
//           updatedBy: req.user.id,
//           date: new Date(),
//         },
//       ],
//     });

//     await report.save();

//     // Generate case ID after save
//     const prefix = report.type.substring(0, 3).toUpperCase();
//     const idSuffix = report._id.toString().slice(-7);
//     report.caseId = `${prefix}-${idSuffix}`;
//     await report.save();

//     // Prepare notifications
//     const notificationPromises = [];

//     // Notify eligible officers
//     eligibleOfficers.forEach(officer => {
//       if (officer.deviceToken) {
//         notificationPromises.push(
//           Notification.create({
//             recipient: officer._id,
//             type: 'NEW_CASE_AVAILABLE',
//             title: `New ${type} Case Alert`,
//             message: nearestOfficer?.officer._id.equals(officer._id)
//               ? `You are the nearest officer to a new ${type} case`
//               : `New ${type} case assigned to your station`,
//             data: {
//               reportId: report._id,
//               caseId: report.caseId,
//               type: report.type,
//               isNearestOfficer: nearestOfficer?.officer._id.equals(officer._id)
//             }
//           })
//         );

//         notificationPromises.push(
//           sendOneSignalNotification({
//             include_player_ids: [officer.deviceToken],
//             headings: { en: `New ${type} Case Alert` },
//             contents: { 
//               en: nearestOfficer?.officer._id.equals(officer._id)
//                 ? `You are the nearest officer to a new ${type} case`
//                 : `New ${type} case assigned to your station`
//             },
//             data: {
//               type: 'NEW_CASE_AVAILABLE',
//               reportId: report._id,
//               caseId: report.caseId,
//               isNearestOfficer: nearestOfficer?.officer._id.equals(officer._id)
//             }
//           })
//         );
//       }
//     });

//     // Notify reporter
//     notificationPromises.push(
//       Notification.create({
//         recipient: req.user.id,
//         type: "REPORT_CREATED",
//         title: "Report Created",
//         message: `Your ${type} report (Case ID: ${report.caseId}) has been created and assigned to ${assignedStation.name}`,
//         data: {
//           reportId: report._id,
//           caseId: report.caseId
//         },
//       })
//     );

//     // Send all notifications
//     try {
//       await Promise.all(notificationPromises);
//     } catch (notificationError) {
//       console.error("Notification failed:", notificationError);
//     }

//     // Get populated report for socket emission
//     const populatedReport = await Report.findById(report._id)
//       .populate("reporter", "firstName lastName")
//       .populate("assignedPoliceStation", "name address")
//       .select({
//         type: 1,
//         caseId: 1,
//         personInvolved: 1,
//         location: 1,
//         status: 1,
//         createdAt: 1,
//       });

//     // Emit socket events
//     const io = getIO();

//     // Emit to police station room
//     io.to(`policeStation_${assignedStation._id}`).emit(SOCKET_EVENTS.NEW_REPORT, {
//       report: populatedReport,
//       message: `New ${type} report assigned to your station`,
//       eligibleOfficers: eligibleOfficers.map(o => ({
//         id: o._id,
//         name: `${o.firstName} ${o.lastName}`,
//         activeCases: o.assignedCases?.length || 0,
//         isNearest: nearestOfficer?.officer._id.equals(o._id)
//       }))
//     });

//     // Emit to city admin room
//     io.to(`city_${location.address.city}`).emit(SOCKET_EVENTS.NEW_REPORT, {
//       report: populatedReport,
//       message: `New ${type} report in your city`
//     });

//     res.status(statusCodes.CREATED).json({
//       success: true,
//       msg: "Report created successfully",
//       data: {
//         report: {
//           ...report.toObject(),
//           caseId: report.caseId
//         },
//         assignedStation,
//         eligibleOfficers: eligibleOfficers.map(o => ({
//           id: o._id,
//           name: `${o.firstName} ${o.lastName}`,
//           activeCases: o.assignedCases?.length || 0,
//           isNearest: nearestOfficer?.officer._id.equals(o._id)
//         })),
//         assignmentType: selectedPoliceStation ? "Manual Selection" : "Automatic Assignment",
//       },
//     });

//   } catch (error) {
//     console.error("Error in createReport:", error);
//     res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
//       success: false,
//       msg: "Error creating report",
//       error: error.message,
//     });
//   }
// });

// Update a report when it's still pending
exports.updateReport = asyncHandler(async (req, res) => {
  // Debug logging for received data
  console.log('Update Report - Received Data:', {
    params: req.params,
    body: req.body,
    files: req.files || 'No files uploaded',
    user: {
      id: req.user.id,
      roles: req.user.roles
    }
  });

  const { reportId } = req.params;
  const { status, followUp, removeImages, personInvolved } = req.body;
  const userId = req.user.id;

  const report = await Report.findById(reportId)
    .populate('reporter', 'deviceToken firstName lastName')
    .populate('assignedPoliceStation', 'name');

  if (!report) {
    return res.status(statusCodes.NOT_FOUND).json({
      success: false,
      msg: errorMessages.REPORT_NOT_FOUND,
    });
  }

  // Check if user is reporter or police officer
  const isReporter = report.reporter._id.toString() === userId;
  const isOfficer = req.user.roles.includes("police");

  if (!isReporter && !isOfficer) {
    return res.status(statusCodes.FORBIDDEN).json({
      success: false,
      msg: "Not authorized to update this report",
    });
  }

  // Update personInvolved fields if provided and user is allowed
  if (personInvolved && (report.status === "Pending" || isOfficer)) {
    Object.keys(personInvolved).forEach(field => {
      if (field !== 'mostRecentPhoto') {
        report.personInvolved[field] = personInvolved[field];
      }
    });
  }

  // Handle image updates only if pending or police officer
  if ((report.status === "Pending" || isOfficer) && req.files) {
    try {
      // Update main photo if provided
      if (req.files["personInvolved[mostRecentPhoto]"]) {
        if (report.personInvolved.mostRecentPhoto?.public_id) {
          await cloudinary.uploader.destroy(
            report.personInvolved.mostRecentPhoto.public_id
          );
        }

        const photoFile = req.files["personInvolved[mostRecentPhoto]"][0];
        const photoResult = await uploadToCloudinary(photoFile.path, "reports");

        report.personInvolved.mostRecentPhoto = {
          url: photoResult.url,
          public_id: photoResult.public_id,
        };
      }

      // Handle additional images
      if (req.files.additionalImages) {
        const uploadPromises = req.files.additionalImages.map((file) =>
          uploadToCloudinary(file.path, "reports")
        );

        const uploadResults = await Promise.all(uploadPromises);
        const newImages = uploadResults.map((result) => ({
          url: result.url,
          public_id: result.public_id,
          uploadedBy: userId,
          uploadedAt: new Date(),
        }));

        report.additionalImages.push(...newImages);
      }
    } catch (uploadError) {
      console.error("Image upload failed:", uploadError);
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: "Failed to upload images",
      });
    }
  }

  // Remove images if requested and allowed
  if (removeImages && (report.status === "Pending" || isOfficer)) {
    const imagesToRemove = Array.isArray(removeImages)
      ? removeImages
      : [removeImages];
    for (const imageId of imagesToRemove) {
      const imageIndex = report.additionalImages.findIndex(
        (img) => img.public_id === imageId || img._id.toString() === imageId
      );

      if (imageIndex !== -1) {
        const image = report.additionalImages[imageIndex];
        await cloudinary.uploader.destroy(image.public_id);
        report.additionalImages.splice(imageIndex, 1);
      }
    }
  }

  // Handle status updates (police only)
  if (status && isOfficer) {
    const validStatuses = [
      "Pending",
      "Assigned",
      "Under Investigation",
      "Resolved",
      "Archived",
    ];
    if (!validStatuses.includes(status)) {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: "Invalid status value",
      });
    }

    report.statusHistory.push({
      previousStatus: report.status,
      newStatus: status,
      updatedBy: userId,
      updatedAt: new Date(),
    });
    report.status = status;
  }

  // Handle follow-up updates
  if (followUp) {
    report.followUp.push({
      note: followUp,
      date: new Date(),
    });
  }

  try {
    await report.save();

    // Get populated report for response
    const updatedReport = await Report.findById(report._id)
      .populate('reporter', 'firstName lastName number email')
      .populate('assignedPoliceStation', 'name address contactNumber')
      .populate('assignedOfficer', 'firstName lastName number')
      .select({
        type: 1,
        status: 1,
        personInvolved: 1,
        location: 1,
        followUp: 1,
        broadcastConsent: 1,
        additionalImages: 1,
        createdAt: 1,
        updatedAt: 1
      });

    // Emit socket event for real-time update
    const io = getIO();
    
    // Emit to police station room
    if (report.assignedPoliceStation) {
      io.to(`policeStation_${report.assignedPoliceStation}`).emit(
        SOCKET_EVENTS.REPORT_UPDATED,
        {
          report: updatedReport,
          message: `Report ${report._id} has been updated`
        }
      );
    }

    // Emit to reporter
    io.to(`user_${report.reporter._id}`).emit(SOCKET_EVENTS.REPORT_UPDATED, {
      report: updatedReport,
      message: 'Your report has been updated'
    });

    // Create notification for reporter if updated by officer
    if (isOfficer && !isReporter) {
      await Notification.create({
        recipient: report.reporter._id,
        type: status ? "STATUS_UPDATED" : "REPORT_UPDATED",
        title: status ? "Report Status Updated" : "Report Updated",
        message: status
          ? `Your report status has been updated to ${status}`
          : "Your report has been updated with new information",
        data: {
          reportId: report._id,
          status: status || report.status,
          updatedBy: userId,
        },
      });
    }

    res.status(statusCodes.OK).json({
      success: true,
      msg: "Report updated successfully",
      data: updatedReport
    });
  } catch (error) {
    console.error("Error updating report:", error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: "Failed to update report",
      error: error.message,
    });
  }
});

//Updating Status of a Report
exports.updateUserReport = asyncHandler(async (req, res) => {
  try {
    const { reportId } = req.params;
    const { status, followUp } = req.body;
    const userId = req.user.id;

    if (!status && !followUp) {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: "Status or follow-up note is required",
      });
    }

    const report = await Report.findById(reportId)
      .populate("reporter", "deviceToken")
      .populate("assignedPoliceStation", "_id name")
      .populate("assignedOfficer", "_id firstName lastName");

    if (!report) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: "Report not found",
      });
    }

    // Initialize followUp array if it doesn't exist
    if (!report.followUp) {
      report.followUp = [];
    }

    // Validate status change
    if (status) {
      const validStatuses = [
        "Pending",
        "Assigned",
        "Under Investigation",
        "Resolved",
        "Archived",
      ];
      if (!validStatuses.includes(status)) {
        return res.status(statusCodes.BAD_REQUEST).json({
          success: false,
          msg: "Invalid status value",
        });
      }

      // Update status
      report.statusHistory = report.statusHistory || []; // Initialize if not exists
      report.statusHistory.push({
        previousStatus: report.status,
        newStatus: status,
        updatedBy: userId,
        updatedAt: new Date(),
      });
      report.status = status;
    }

    // Add follow-up if provided
    if (followUp) {
      report.followUp.push({
        note: followUp,
        updatedBy: userId,
        updatedAt: new Date()
      });
    }

    await report.save();

    // Get updated report with populated fields
    const updatedReport = await Report.findById(reportId)
      .populate("reporter", "deviceToken firstName lastName")
      .populate("assignedPoliceStation", "name")
      .populate("assignedOfficer", "firstName lastName")
      .select({
        status: 1,
        followUp: 1,
        statusHistory: 1,
        updatedAt: 1
      });

    // Handle notifications
    if (report.reporter?.deviceToken) {
      await sendOneSignalNotification({
        include_player_ids: [report.reporter.deviceToken],
        title: status ? "Report Status Update" : "Follow-up Added",
        message: status 
          ? `Your report status has been updated to: ${status}`
          : "A new follow-up note has been added to your report",
        data: {
          type: status ? "STATUS_UPDATED" : "FOLLOWUP_ADDED",
          reportId: report._id.toString(),
          status: status || report.status,
        },
      });
    }

    // Emit socket event
    const io = getIO();
    io.to(`user_${report.reporter._id}`).emit(SOCKET_EVENTS.REPORT_UPDATED, {
      report: updatedReport,
      message: status ? 'Status updated' : 'Follow-up added'
    });

    return res.status(statusCodes.OK).json({
      success: true,
      msg: status ? "Report status updated successfully" : "Follow-up added successfully",
      data: updatedReport
    });

  } catch (error) {
    console.error("Error updating report:", error);
    return res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: "Failed to update report",
      error: error.message,
    });
  }
});

// Get Reports (with filters)
exports.getReports = asyncHandler(async (req, res) => {
  try {
    const {
      status,
      type,
      startDate,
      endDate,
      page = 1,
      limit = 10,
    } = req.query;
    let query = {};

    // Role-based filtering
    switch (req.user.roles[0]) {
      case "police_officer":
      case "police_admin":
        // Only see reports assigned to their police station
        if (!req.user.policeStation) {
          return res.status(statusCodes.BAD_REQUEST).json({
            success: false,
            msg: "Officer/Admin must be assigned to a police station",
          });
        }
        query.assignedPoliceStation = req.user.policeStation;
        break;

      case "city_admin":
        // Get all stations in the admin's city
        const cityStations = await PoliceStation.find({
          "address.city": req.user.address.city,
        });
        query.assignedPoliceStation = {
          $in: cityStations.map((station) => station._id),
        };
        break;

      case "super_admin":
        // Can see all reports
        break;

      default:
        return res.status(statusCodes.FORBIDDEN).json({
          success: false,
          msg: "Not authorized to view reports",
        });
    }

    // Apply additional filters
    if (status) query.status = status;
    if (type) query.type = type;
    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    // Get paginated reports
    const reports = await Report.find(query)
      .populate("reporter", "-password")
      .populate("assignedPoliceStation")
      .populate("assignedOfficer", "firstName lastName number email")
      .sort("-createdAt")
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await Report.countDocuments(query);

    res.status(statusCodes.OK).json({
      success: true,
      data: {
        reports,
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalReports: total,
        hasMore: page * limit < total,
      },
    });
  } catch (error) {
    console.error("Error getting reports:", error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: "Error retrieving reports",
      error: error.message,
    });
  }
});

// Delete Report
exports.deleteReport = asyncHandler(async (req, res) => {
  const { reportId } = req.params;
  const isAdmin = req.user.roles.includes("admin");

  if (!isAdmin) {
    return res.status(statusCodes.FORBIDDEN).json({
      msg: "Only administrators can delete reports",
    });
  }

  const report = await Report.findById(reportId);
  if (!report) {
    return res.status(statusCodes.NOT_FOUND).json({
      msg: errorMessages.REPORT_NOT_FOUND,
    });
  }

  // Delete associated images
  if (report.additionalImages?.length) {
    for (const image of report.additionalImages) {
      await cloudinary.uploader.destroy(image.public_id);
    }
  }
  if (report.personInvolved?.mostRecentPhoto?.public_id) {
    await cloudinary.uploader.destroy(
      report.personInvolved.mostRecentPhoto.public_id
    );
  }

  await report.deleteOne();
  res.status(statusCodes.OK).json({
    msg: "Report deleted successfully",
  });
});

// Assign a police station to a report
exports.assignPoliceStation = asyncHandler(async (req, res) => {
  const { reportId, policeStationId } = req.body;
  const isOfficer = req.user.roles.includes("police");

  if (!isOfficer) {
    return res.status(statusCodes.FORBIDDEN).json({
      msg: "Only police officers can assign police stations",
    });
  }

  const report = await Report.findById(reportId);
  const policeStation = await PoliceStation.findById(policeStationId);

  if (!report) {
    return res.status(statusCodes.NOT_FOUND).json({
      msg: errorMessages.REPORT_NOT_FOUND,
    });
  }

  if (!policeStation) {
    return res.status(statusCodes.NOT_FOUND).json({
      msg: errorMessages.POLICE_STATION_NOT_FOUND,
    });
  }

  if (report.status !== "Pending") {
    return res.status(statusCodes.BAD_REQUEST).json({
      msg: "Can only assign police station to pending reports",
    });
  }

  report.assignedPoliceStation = policeStation._id;
  report.status = "Assigned";
  await report.save();

  await notifyPoliceStation(report, policeStation);

  res.status(statusCodes.OK).json(report);
});

// Assign an officer to a report
exports.assignOfficer = asyncHandler(async (req, res) => {
  const { reportId, officerId } = req.body;
  const isPoliceAdmin = req.user.roles.includes("police_admin");

  if (!isPoliceAdmin) {
    return res.status(statusCodes.FORBIDDEN).json({
      msg: "Only police admins can assign officers to reports",
    });
  }

  // Get report with populated fields
  const report = await Report.findById(reportId)
    .populate("assignedPoliceStation")
    .populate("reporter")
    .populate("personInvolved");

  if (!report) {
    return res.status(statusCodes.NOT_FOUND).json({
      msg: errorMessages.REPORT_NOT_FOUND,
    });
  }

  // Get officer details
  const officer = await User.findOne({
    _id: officerId,
    roles: "police_officer",
    policeStation: report.assignedPoliceStation._id,
  });

  if (!officer) {
    return res.status(statusCodes.NOT_FOUND).json({
      msg: "Officer not found or does not belong to the assigned police station",
    });
  }

  // Update report
  report.assignedOfficer = officer._id;
  report.status = "Assigned";
  await report.save();

  // Prepare notification data
  const notificationPromises = [];

  // 1. Officer notifications
  notificationPromises.push(
    // In-app notification
    Notification.create({
      recipient: officer._id,
      type: "ASSIGNED_OFFICER",
      title: "New Case Assignment",
      message: `You have been assigned to a ${report.type} case for ${report.personInvolved.firstName} ${report.personInvolved.lastName}`,
      data: {
        reportId: report._id,
        type: report.type,
        reportDetails: {
          location: report.location,
          status: report.status,
          personInvolved: {
            name: `${report.personInvolved.firstName} ${report.personInvolved.lastName}`,
            age: report.personInvolved.age,
          },
        },
      },
    })
  );

  // Push notification for officer
  if (officer.deviceToken) {
    notificationPromises.push(
      sendOneSignalNotification({
        include_player_ids: [officer.deviceToken],
        headings: { en: "New Case Assignment" },
        contents: { en: `You have been assigned to a ${report.type} case` },
        data: {
          type: "ASSIGNED_OFFICER",
          reportId: report._id,
          caseType: report.type,
        },
      })
    );
  }

  // 2. Reporter notifications
  if (report.reporter) {
    // In-app notification
    notificationPromises.push(
      Notification.create({
        recipient: report.reporter._id,
        type: "STATUS_UPDATED",
        title: "Report Update",
        message: `Your report has been assigned to an investigating officer`,
        data: {
          reportId: report._id,
          status: report.status,
          assignedOfficer: {
            name: `${officer.firstName} ${officer.lastName}`,
            badge: officer.badgeNumber,
          },
        },
      })
    );

    // Push notification for reporter
    if (report.reporter.deviceToken) {
      notificationPromises.push(
        sendOneSignalNotification({
          include_player_ids: [report.reporter.deviceToken],
          headings: { en: "Report Update" },
          contents: {
            en: "Your report has been assigned to an investigating officer",
          },
          data: {
            type: "STATUS_UPDATED",
            reportId: report._id,
            status: report.status,
          },
        })
      );
    }
  }

  // Send all notifications
  try {
    await Promise.allSettled(notificationPromises);
  } catch (error) {
    console.error("Notification error:", error);
  }

  res.status(statusCodes.OK).json({
    success: true,
    msg: "Officer assigned successfully",
    data: {
      report,
      assignedOfficer: {
        id: officer._id,
        name: `${officer.firstName} ${officer.lastName}`,
        badge: officer.badgeNumber,
      },
    },
  });
});

exports.getPublicFeed = asyncHandler(async (req, res) => {
  try {
    const { page = 1, limit = 10, city, type, firstName, lastName, searchName } = req.query;
    const currentPage = parseInt(page);
    const limitPerPage = parseInt(limit);

    // Base query for public reports
    let query = {
      broadcastConsent: true,
      isPublished: true,
      status: { $ne: "Resolved" },
    };

    // Add city filter if provided
    if (city) {
      query["location.address.city"] = city;
    }

    // Add type filter if provided and valid
    if (
      type &&
      ["Missing", "Abducted", "Kidnapped", "Hit-and-Run"].includes(type)
    ) {
      query.type = type;
    }

    // Add firstName filter if provided
    if (firstName) {
      query["personInvolved.firstName"] = new RegExp(firstName, 'i'); // Case-insensitive search
    }

    // Add lastName filter if provided
    if (lastName) {
      query["personInvolved.lastName"] = new RegExp(lastName, 'i'); // Case-insensitive search
    }

    // Add searchName filter if provided
    if (searchName) {
      query["$or"] = [
        { "personInvolved.firstName": new RegExp(searchName, 'i') },
        { "personInvolved.lastName": new RegExp(searchName, 'i') },
        { $expr: { $regexMatch: { input: { $concat: ["$personInvolved.firstName", " ", "$personInvolved.lastName"] }, regex: searchName, options: "i" } } }
      ];
    }

    const reports = await Report.find(query)
      .populate('reporter', 'firstName lastName avatar') // Populate reporter details
      .select({
        type: 1,
        "personInvolved.firstName": 1,
        "personInvolved.lastName": 1,
        "personInvolved.age": 1,
        "personInvolved.lastSeenDate": 1,
        "personInvolved.lastSeentime": 1,
        "personInvolved.lastKnownLocation": 1,
        "personInvolved.mostRecentPhoto": 1,
        "location.address.city": 1,
        createdAt: 1,
      })
      .sort("-createdAt")
      .skip((currentPage - 1) * limitPerPage)
      .limit(limitPerPage);

    const total = await Report.countDocuments(query);

    const feedReports = reports.map((report) => ({
      id: report._id,
      type: report.type,
      personName: `${report.personInvolved.firstName} ${report.personInvolved.lastName}`,
      age: report.personInvolved.age,
      lastSeen: {
        date: report.personInvolved.lastSeenDate,
        time: report.personInvolved.lastSeentime,
      },
      lastKnownLocation: report.personInvolved.lastKnownLocation,
      city: report.location.address.city,
      photo: report.personInvolved.mostRecentPhoto.url,
      reportedAt: report.createdAt,
      reporter: {
        name: `${report.reporter.firstName} ${report.reporter.lastName}`,
        avatar: report.reporter.avatar.url,
      },
    }));

    res.status(statusCodes.OK).json({
      success: true,
      data: {
        reports: feedReports,
        currentPage,
        totalPages: Math.ceil(total / limitPerPage),
        totalReports: total,
        hasMore: currentPage * limitPerPage < total,
      },
    });
  } catch (error) {
    console.error("Error getting public feed:", error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: "Error retrieving public feed",
      error: error.message,
    });
  }
});

// Get distinct cities with active reports that have broadcast consent
exports.getReportCities = asyncHandler(async (req, res) => {
  try {
    const cities = await Report.distinct("location.address.city", {
      broadcastConsent: true,
      status: { $ne: "Resolved" },
    });

    const sortedCities = cities
      .filter((city) => city)
      .sort((a, b) => a.localeCompare(b));

    res.status(statusCodes.OK).json({
      success: true,
      data: {
        cities: sortedCities,
        total: sortedCities.length,
      },
    });
  } catch (error) {
    console.error("Error fetching report cities:", error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: "Error retrieving cities",
      error: error.message,
    });
  }
});

// Get User's Reports
exports.getUserReports = asyncHandler(async (req, res) => {
  try {
    const { page = 1, limit = 10, status, type } = req.query;
    const currentPage = parseInt(page);
    const limitPerPage = parseInt(limit);

    // Base query - get reports where user is reporter
    let query = { reporter: req.user.id };

    // Add filters if provided
    if (status) query.status = status;
    if (type) query.type = type;

    const reports = await Report.find(query)
      .select({
        type: 1,
        "personInvolved.firstName": 1,
        "personInvolved.lastName": 1,
        "personInvolved.age": 1,
        "personInvolved.lastSeenDate": 1,
        "personInvolved.mostRecentPhoto": 1,
        "location.address": 1,
        status: 1,
        broadcastConsent: 1,
        createdAt: 1,
      })
      .populate("assignedPoliceStation", "name address")
      .sort("-createdAt")
      .skip((currentPage - 1) * limitPerPage)
      .limit(limitPerPage);

    const total = await Report.countDocuments(query);

    res.status(statusCodes.OK).json({
      success: true,
      data: {
        reports,
        currentPage,
        totalPages: Math.ceil(total / limitPerPage),
        totalReports: total,
        hasMore: currentPage * limitPerPage < total,
      },
    });
  } catch (error) {
    console.error("Error getting user reports:", error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: "Error retrieving user reports",
      error: error.message,
    });
  }
});

// Get User's Report Details
exports.getUserReportDetails = asyncHandler(async (req, res) => {
  try {
    const { reportId } = req.params;
    const userId = req.user.id;
    const userRoles = req.user.roles;

    let report;

    // Case 1: Admin/Officer Access - Full Details
    if (
      userRoles.some((role) =>
        [
          "police_officer",
          "police_admin",
          "city_admin",
          "super_admin",
        ].includes(role)
      )
    ) {
      let query = { _id: reportId };

      if (
        userRoles.includes("police_officer") ||
        userRoles.includes("police_admin")
      ) {
        query.assignedPoliceStation = req.user.policeStation;
      } else if (userRoles.includes("city_admin")) {
        const cityStations = await PoliceStation.find({
          "address.city": req.user.address.city,
        });
        query.assignedPoliceStation = {
          $in: cityStations.map((station) => station._id),
        };
      }

      // Full details for officers/admins
      report = await Report.findOne(query)
        .populate("reporter", "firstName lastName number email address")
        .populate("assignedPoliceStation")
        .populate("assignedOfficer")
        .populate("broadcastHistory.publishedBy", "firstName lastName roles")
        .populate("consentUpdateHistory.updatedBy", "firstName lastName")
        .select({
          type: 1,
          personInvolved: 1,
          additionalImages: 1,
          location: 1,
          status: 1,
          followUp: 1,
          broadcastConsent: 1,
          isPublished: 1,
          consentUpdateHistory: 1,
          broadcastHistory: 1,
          publishSchedule: 1,
          createdAt: 1,
          updatedAt: 1,
          reporter: 1,
          assignedPoliceStation: 1,
          assignedOfficer: 1,
        });

      // Case 2: Report Owner Access - Limited Details
    } else if (userId) {
      report = await Report.findOne({
        _id: reportId,
        $or: [{ reporter: userId }, { broadcastConsent: true }]
      })
      .populate("reporter", "firstName lastName number email address")
      .populate("assignedPoliceStation", "name address contactNumber")
      .populate("assignedOfficer", "firstName lastName number")
      .select({
        type: 1,
        personInvolved: {
          firstName: 1,
          lastName: 1,
          alias: 1,
          age: 1,
          dateOfBirth: 1,
          gender: 1,
          race: 1,
          height: 1,
          weight: 1,
          eyeColor: 1,
          hairColor: 1,
          scarsMarksTattoos: 1,
          birthDefects: 1,
          prosthetics: 1,
          bloodType: 1,
          medications: 1,
          lastKnownClothing: 1,
          lastSeenDate: 1,
          lastSeentime: 1,
          lastKnownLocation: 1,
          contactInformation: 1,
          relationship: 1,
          otherInformation: 1,
          mostRecentPhoto: 1
        },
        additionalImages: 1,
        location: 1,
        status: 1,
        followUp: 1,
        broadcastConsent: 1,
        createdAt: 1,
        updatedAt: 1,
        assignedPoliceStation: 1,
        assignedOfficer: 1
      });
    }else {
      report = await Report.findOne({
        _id: reportId,
        broadcastConsent: true,
      }).select({
        type: 1,
        "personInvolved.firstName": 1,
        "personInvolved.lastName": 1,
        "personInvolved.age": 1,
        "personInvolved.lastSeenDate": 1,
        "personInvolved.lastSeentime": 1,
        "personInvolved.mostRecentPhoto": 1,
        "location.address": 1,
        createdAt: 1,
      });
    }

    if (!report) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: errorMessages.REPORT_NOT_FOUND,
      });
    }

    res.status(statusCodes.OK).json({
      success: true,
      data: report,
    });
  } catch (error) {
    console.error("Error getting report details:", error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: "Error retrieving report details",
      error: error.message,
    });
  }
});

// Search Reports
exports.searchReports = asyncHandler(async (req, res) => {
  try {
    console.log("Search params:", req.query);

    const { query = "", page = 1, limit = 10, status, type } = req.query;

    const currentPage = parseInt(page);
    const limitPerPage = parseInt(limit);
    let searchQuery = {};

    // Role-based filtering
    switch (req.user.roles[0]) {
      case "police_officer":
      case "police_admin":
        if (!req.user.policeStation) {
          return res.status(statusCodes.BAD_REQUEST).json({
            success: false,
            msg: "Officer/Admin must be assigned to a police station",
          });
        }
        searchQuery.assignedPoliceStation = req.user.policeStation;
        break;

      case "city_admin":
        const cityStations = await PoliceStation.find({
          "address.city": req.user.address.city,
        });
        searchQuery.assignedPoliceStation = {
          $in: cityStations.map((station) => station._id),
        };
        break;

      case "super_admin":
        // Super admin can see all reports
        break;

      default:
        return res.status(statusCodes.FORBIDDEN).json({
          success: false,
          msg: "Not authorized to search reports",
        });
    }

    // Text search
    if (query.trim()) {
      const searchTerms = query
        .trim()
        .split(" ")
        .filter((term) => term.length > 0);

      searchQuery.$or = [
        // Name searches
        { "personInvolved.firstName": { $regex: query, $options: "i" } },
        { "personInvolved.lastName": { $regex: query, $options: "i" } },
        { "personInvolved.alias": { $regex: query, $options: "i" } },
        // Location searches
        { "location.address.barangay": { $regex: query, $options: "i" } },
        { "location.address.city": { $regex: query, $options: "i" } },
        // Type search
        { type: { $regex: query, $options: "i" } },
      ];

      if (searchTerms.length > 1) {
        // Add full name searches
        searchQuery.$or.push(
          {
            $and: [
              {
                "personInvolved.firstName": {
                  $regex: searchTerms[0],
                  $options: "i",
                },
              },
              {
                "personInvolved.lastName": {
                  $regex: searchTerms[1],
                  $options: "i",
                },
              },
            ],
          },
          {
            $and: [
              {
                "personInvolved.firstName": {
                  $regex: searchTerms[1],
                  $options: "i",
                },
              },
              {
                "personInvolved.lastName": {
                  $regex: searchTerms[0],
                  $options: "i",
                },
              },
            ],
          }
        );
      }
    }

    // Status and type filters (case insensitive)
    if (status) {
      searchQuery.status = { $regex: new RegExp(status, "i") };
    }
    if (type) {
      searchQuery.type = { $regex: new RegExp(type, "i") };
    }

    console.log("Final search query:", JSON.stringify(searchQuery, null, 2));

    // Execute search with pagination
    const [reports, total] = await Promise.all([
      Report.find(searchQuery)
        .populate("reporter", "firstName lastName number email")
        .populate("assignedPoliceStation", "name address")
        .populate("assignedOfficer", "firstName lastName number")
        .select({
          type: 1,
          status: 1,
          personInvolved: 1,
          "location.address": 1,
          createdAt: 1,
          updatedAt: 1,
          broadcastConsent: 1,
        })
        .sort("-createdAt")
        .skip((currentPage - 1) * limitPerPage)
        .limit(limitPerPage),
      Report.countDocuments(searchQuery),
    ]);

    res.status(statusCodes.OK).json({
      success: true,
      data: {
        reports,
        currentPage,
        totalPages: Math.ceil(total / limitPerPage),
        totalReports: total,
        hasMore: currentPage * limitPerPage < total,
        query: query || null,
        type: type || null,
        status: status || null,
      },
    });
  } catch (error) {
    console.error("Search error:", error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: "Error searching reports",
      error: error.message,
    });
  }
});

// Reassign report to different police station
exports.reassignPoliceStation = asyncHandler(async (req, res) => {
  try {
    const { reportId, newStationId } = req.body;

    // Authorization check
    if (
      !req.user.roles.some((role) =>
        ["city_admin", "super_admin"].includes(role)
      )
    ) {
      return res.status(statusCodes.FORBIDDEN).json({
        success: false,
        msg: "Only city admin or super admin can reassign police stations",
      });
    }

    // Get report details
    const report = await Report.findById(reportId)
      .populate("assignedPoliceStation")
      .populate("reporter");

    if (!report) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: errorMessages.REPORT_NOT_FOUND,
      });
    }

    // Get new station
    const newStation = await PoliceStation.findById(newStationId);
    if (!newStation) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: "New police station not found",
      });
    }

    const oldStation = report.assignedPoliceStation;

    // Update report
    report.assignedPoliceStation = newStationId;
    report.assignedOfficer = null;
    await report.save();

    // Notification promises array
    const notificationPromises = [];

    // 1. Notify old station admins
    const oldStationAdmins = await User.find({
      policeStation: oldStation._id,
      roles: "police_admin",
      deviceToken: { $exists: true },
    });

    oldStationAdmins.forEach((admin) => {
      notificationPromises.push(
        sendOneSignalNotification({
          include_player_ids: [admin.deviceToken],
          headings: { en: "Report Reassigned" },
          contents: {
            en: `Report #${report._id} has been reassigned to ${newStation.name}`,
          },
          data: {
            type: "REPORT_REASSIGNED",
            reportId: report._id,
          },
        })
      );
    });

    // 2. Notify new station admins
    const newStationAdmins = await User.find({
      policeStation: newStationId,
      roles: "police_admin",
      deviceToken: { $exists: true },
    });

    newStationAdmins.forEach((admin) => {
      notificationPromises.push(
        sendOneSignalNotification({
          include_player_ids: [admin.deviceToken],
          headings: { en: "New Report Assignment" },
          contents: { en: `A new report has been assigned to your station` },
          data: {
            type: "NEW_REPORT_ASSIGNED",
            reportId: report._id,
          },
        })
      );
    });

    // 3. Notify reporter
    if (report.reporter?.deviceToken) {
      notificationPromises.push(
        sendOneSignalNotification({
          include_player_ids: [report.reporter.deviceToken],
          headings: { en: "Report Update" },
          contents: {
            en: `Your report has been reassigned to ${newStation.name}`,
          },
          data: {
            type: "REPORT_REASSIGNED",
            reportId: report._id,
            oldStation: oldStation.name,
            newStation: newStation.name,
          },
        })
      );
    }

    // Send all notifications
    await Promise.allSettled(notificationPromises);

    res.status(statusCodes.OK).json({
      success: true,
      msg: `Report reassigned to ${newStation.name}`,
      data: {
        report,
        oldStation: oldStation.name,
        newStation: newStation.name,
      },
    });
  } catch (error) {
    console.error("Error reassigning police station:", error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: "Error reassigning police station",
      error: error.message,
    });
  }
});



// Add this new controller function
exports.updateAllReportCaseIds = asyncHandler(async (req, res) => {
  try {
    // Get all reports, regardless of whether they have a caseId
    const reports = await Report.find({});
    
    console.log(`Found ${reports.length} reports to update`);
    
    let updatedCount = 0;
    
    // Update each report
    for (const report of reports) {
      const prefix = report.type.substring(0, 3).toUpperCase();
      const idSuffix = report._id.toString().slice(-7);
      const newCaseId = `${prefix}-${idSuffix}`;
      
      // Only update if the caseId is different
      if (report.caseId !== newCaseId) {
        report.caseId = newCaseId;
        await report.save();
        updatedCount++;
      }
    }

    res.status(statusCodes.OK).json({
      success: true,
      message: `Updated ${updatedCount} reports with new case IDs`,
      data: {
        totalReports: reports.length,
        updatedCount,
        examples: reports.slice(0, 5).map(r => ({
          id: r._id,
          oldCaseId: r.caseId,
          newCaseId: `${r.type.substring(0, 3).toUpperCase()}-${r._id.toString().slice(-7)}`,
          type: r.type
        }))
      }
    });

  } catch (error) {
    console.error('Error updating report case IDs:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Error updating report case IDs',
      error: error.message
    });
  }
});


// Search Reports (Public)
exports.searchPublicReports = asyncHandler(async (req, res) => {
  try {
    const { searchQuery, page = 1, limit = 10, city } = req.query;
    const currentPage = parseInt(page);
    const limitPerPage = parseInt(limit);

    // Base query - only published & consented reports
    let query = {
      broadcastConsent: true,
      isPublished: true,
      status: { $ne: "Resolved" }
    };

    // Add search conditions if searchQuery exists 
    if (searchQuery) {
      const searchTerms = searchQuery.trim().split(" ").filter(term => term.length > 0);
      
      query.$or = [
        // Name searches (partial matches, case insensitive)
        { "personInvolved.firstName": { $regex: searchQuery, $options: "i" } },
        { "personInvolved.lastName": { $regex: searchQuery, $options: "i" } },
        
        // Location searches
        { "location.address.streetAddress": { $regex: searchQuery, $options: "i" } },
        { "location.address.barangay": { $regex: searchQuery, $options: "i" } },
        { "location.address.city": { $regex: searchQuery, $options: "i" } },
        
        // Type search
        { type: { $regex: searchQuery, $options: "i" } }
      ];

      // Add full name search for multiple terms
      if (searchTerms.length > 1) {
        query.$or.push(
          // First term as first name, second as last name
          {
            $and: [
              { "personInvolved.firstName": { $regex: searchTerms[0], $options: "i" } },
              { "personInvolved.lastName": { $regex: searchTerms[1], $options: "i" } }
            ]
          },
          // First term as last name, second as first name
          {
            $and: [
              { "personInvolved.firstName": { $regex: searchTerms[1], $options: "i" } },
              { "personInvolved.lastName": { $regex: searchTerms[0], $options: "i" } }
            ]
          }
        );
      }
    }

    // Add city filter if provided
    if (city) {
      query["location.address.city"] = { $regex: new RegExp(city, "i") };
    }

    // Execute search with pagination
    const reports = await Report.find(query)
      .select({
        type: 1,
        personInvolved: {
          firstName: 1,
          lastName: 1,
          age: 1,
          lastSeenDate: 1,
          lastSeentime: 1,
          mostRecentPhoto: 1
        },
        location: 1,
        createdAt: 1
      })
      .sort("-createdAt")
      .skip((currentPage - 1) * limitPerPage)
      .limit(limitPerPage);

    const total = await Report.countDocuments(query);

    res.status(statusCodes.OK).json({
      success: true,
      data: {
        reports: reports.map(report => ({
          id: report._id,
          type: report.type,
          personName: `${report.personInvolved.firstName} ${report.personInvolved.lastName}`,
          age: report.personInvolved.age,
          lastSeen: {
            date: report.personInvolved.lastSeenDate,
            time: report.personInvolved.lastSeentime
          },
          location: report.location.address,
          photo: report.personInvolved.mostRecentPhoto.url,
          reportedAt: report.createdAt
        })),
        currentPage,
        totalPages: Math.ceil(total / limitPerPage),
        totalResults: total,
        hasMore: currentPage * limitPerPage < total
      }
    });

  } catch (error) {
    console.error("Search error:", error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false, 
      msg: "Error searching reports",
      error: error.message
    });
  }
});
