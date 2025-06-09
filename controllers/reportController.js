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
const { sendTransferEmailWithAttachments, sendArchiveEmail, sendArchiveEmailWithImages } = require("../utils/sendEmail");

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
// exports.createReport = asyncHandler(async (req, res) => {
//   try {
//     let { type, personInvolved, location, selectedPoliceStation } = req.body;

//     // Automatically handle Missing/Absent classification
//     if (type === "Missing" || type === "Absent") {
//       const timeCheck = isLastSeenMoreThan24Hours(
//         personInvolved.lastSeenDate,
//         personInvolved.lastSeentime
//       );

//       // Automatically set type based on hours passed
//       type = timeCheck.isMoreThan24Hours ? "Missing" : "Absent";

//       // No need to throw error, just inform about the classification
//       const message = timeCheck.isMoreThan24Hours
//         ? `Case classified as 'Missing Person' since person has been missing for ${timeCheck.hoursPassed} hours.`
//         : `Case classified as 'Absent Person' since person has been missing for ${timeCheck.hoursPassed} hours.`;

//       console.log("Time check result:", {
//         timeCheck,
//         assignedType: type,
//         message,
//       });
//     }

//     const broadcastConsent = req.body.broadcastConsent === "true";

//     // Validate input
//     if (
//       !type ||
//       !personInvolved ||
//       !location ||
//       typeof broadcastConsent !== "boolean"
//     ) {
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

//     // Find police station
//     let assignedStation = await findPoliceStation(
//       selectedPoliceStation,
//       geoData.coordinates
//     );
//     if (!assignedStation) {
//       return res.status(statusCodes.NOT_FOUND).json({
//         success: false,
//         msg: "No police stations found in the system",
//       });
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
//       location: {
//         type: "Point",
//         coordinates: geoData.coordinates,
//         address: location.address,
//       },
//       assignedPoliceStation: assignedStation._id,
//       broadcastConsent: broadcastConsent,
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

//     // Get populated report data for socket emission
//     const populatedReport = await Report.findById(report._id)
//       .populate("reporter", "firstName lastName")
//       .populate("assignedPoliceStation", "name address")
//       .select({
//         type: 1,
//         personInvolved: 1,
//         location: 1,
//         status: 1,
//         createdAt: 1,
//       });

//     // Emit socket event for new report
//     const io = getIO();

//     // Emit to police station room
//     io.to(`policeStation_${assignedStation._id}`).emit(
//       SOCKET_EVENTS.NEW_REPORT,
//       {
//         report: populatedReport,
//         message: `New ${type} report assigned to your station`,
//       }
//     );

//     // Emit to city admin room if exists
//     io.to(`city_${location.address.city}`).emit(SOCKET_EVENTS.NEW_REPORT, {
//       report: populatedReport,
//       message: `New ${type} report in your city`,
//     });

//     // Handle notifications
//     try {
//       await notifyPoliceStation(report, assignedStation);

//       // Notify reporter
//       await Notification.create({
//         recipient: req.user.id,
//         type: "REPORT_CREATED",
//         title: "Report Created",
//         message: `Your ${type} report has been created and assigned to ${assignedStation.name}`,
//         data: {
//           reportId: report._id,
//         },
//       });
//     } catch (notificationError) {
//       console.error("Notification failed:", notificationError);
//     }

//     res.status(statusCodes.CREATED).json({
//       success: true,
//       msg: "Report created successfully",
//       data: {
//         report,
//         assignedStation,
//         assignmentType: selectedPoliceStation
//           ? "Manual Selection"
//           : "Automatic Assignment",
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
const calculateDistance = (coord1, coord2) => {
  const [lon1, lat1] = coord1;
  const [lon2, lat2] = coord2;
  
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c; // Distance in kilometers
  
  return distance;
};
//create report v2
exports.createReport = asyncHandler(async (req, res) => {
  try {
    console.log("Create report request body:", JSON.stringify(req.body, null, 2));
    let { type, personInvolved, location, selectedPoliceStation } = req.body;
    
    // Ensure personInvolved is properly initialized
    personInvolved = personInvolved || {};
    
    let classifiedType = type;
    // Automatically handle Missing/Absent classification
    try {
      if (type === "Missing" || type === "Absent") {
        // Debug time inputs
        console.log("Time inputs:", {
          lastSeenDate: personInvolved.lastSeenDate,
          lastSeentime: personInvolved.lastSeentime
        });
        
        // Format check - if time is invalid, default to current type
        if (!personInvolved.lastSeenDate || !personInvolved.lastSeentime ||
            !/^\d{1,2}:\d{2}(:\d{2})?$/.test(personInvolved.lastSeentime)) {
          console.warn("Invalid date/time format, using original type:", type);
        } else {
          const timeCheck = isLastSeenMoreThan24Hours(
            personInvolved.lastSeenDate,
            personInvolved.lastSeentime
          );
          classifiedType = timeCheck.isMoreThan24Hours ? "Missing" : "Absent";
          console.log(`Time check results: Last seen ${timeCheck.hoursPassed} hours ago. Classified as: ${classifiedType}`);
        }
      }
    } catch (timeError) {
      console.error("Error during time classification check:", timeError);
      // Keep the original type if there's an error
    }
    
    type = classifiedType;

    const broadcastConsent = req.body.broadcastConsent === "true";

    // Validate input
    if (!type || !personInvolved || !location || typeof broadcastConsent !== "boolean") {
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

    // Handle video upload
    let video = null;
    if (req.files?.video) {
      try {
        const videoFile = req.files.video[0];
        console.log("Uploading video:", videoFile.path);
        const videoResult = await uploadToCloudinary(
          videoFile.path, 
          "report_videos", 
          "video"
        );
        video = {
          url: videoResult.url,
          public_id: videoResult.public_id
        };
        console.log("Video uploaded successfully:", video);
      } catch (videoError) {
        console.error("Error uploading video:", videoError);
        // Continue without video if upload fails
      }
    }

    // Find police station
    let assignedStation = await findPoliceStation(selectedPoliceStation, geoData.coordinates);
    if (!assignedStation) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: "No police stations found in the system",
      });
    }

    // Find available officers
    const availableOfficers = await User.find({
  policeStation: assignedStation._id,
  roles: 'police_officer',
  isOnDuty: true
});

    // Filter officers with less than 3 active cases
    const eligibleOfficers = [];
for (const officer of availableOfficers) {
  const activeCasesCount = await Report.countDocuments({
    assignedOfficer: officer._id,
    status: { $ne: 'Resolved' }
  });
  
  if (activeCasesCount < 10) {
    officer.activeCasesCount = activeCasesCount;
    eligibleOfficers.push(officer);
  }
}

    // Find nearest officer
    let nearestOfficer = null;
    if (eligibleOfficers.length > 0) {
      nearestOfficer = eligibleOfficers.reduce((nearest, officer) => {
        if (!officer.location?.coordinates) return nearest;
        
        const distance = calculateDistance(
          geoData.coordinates,
          officer.location.coordinates
        );

        if (!nearest || distance < nearest.distance) {
          return { officer, distance };
        }
        return nearest;
      }, null);
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
      video,
      location: {
        type: "Point",
        coordinates: geoData.coordinates,
        address: location.address,
      },
      assignedPoliceStation: assignedStation._id,
      broadcastConsent,
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

    // Auto-assign nearest officer if available
    if (nearestOfficer) {
  report.assignedOfficer = nearestOfficer.officer._id;
  report.status = "Assigned";
  
  console.log(`Auto-assigned nearest officer: ${nearestOfficer.officer.firstName} ${nearestOfficer.officer.lastName} (${nearestOfficer.distance.toFixed(2)}km away)`);
} else if (eligibleOfficers.length > 0) {
  // If no location data for distance calculation, assign to officer with least active cases
  const leastBusyOfficer = eligibleOfficers.reduce((least, officer) => 
    (officer.activeCasesCount || 0) < (least.activeCasesCount || 0) ? officer : least
  );
  
  report.assignedOfficer = leastBusyOfficer._id;
  report.status = "Assigned";
  
  console.log(`Auto-assigned least busy officer: ${leastBusyOfficer.firstName} ${leastBusyOfficer.lastName} (${leastBusyOfficer.activeCasesCount || 0} active cases)`);
} else if (eligibleOfficers.length > 0) {
      // If no location data for distance calculation, assign to officer with least active cases
      const leastBusyOfficer = eligibleOfficers.reduce((least, officer) => 
        (officer.assignedCases?.length || 0) < (least.assignedCases?.length || 0) ? officer : least
      );
      
      report.assignedOfficer = leastBusyOfficer._id;
      report.status = "Assigned";
      
      console.log(`Auto-assigned least busy officer: ${leastBusyOfficer.firstName} ${leastBusyOfficer.lastName} (${leastBusyOfficer.assignedCases?.length || 0} active cases)`);
      
      // Add to officer's assigned cases
      try {
        await User.findByIdAndUpdate(leastBusyOfficer._id, {
          $addToSet: { assignedCases: report._id }
        });
      } catch (error) {
        console.error("Error updating officer's assigned cases:", error);
      }
    }

    // Generate case ID after save
    const prefix = report.type.substring(0, 3).toUpperCase();
    const idSuffix = report._id.toString().slice(-7);
    report.caseId = `${prefix}-${idSuffix}`;
    await report.save();

    // Prepare notifications
    const notificationPromises = [];

    // Notify eligible officers
    // Notify eligible officers
eligibleOfficers.forEach(officer => {
  if (officer.deviceToken) {
    const isAssigned = report.assignedOfficer && report.assignedOfficer.equals(officer._id);
    const isNearest = nearestOfficer?.officer._id.equals(officer._id);
    
    // Different messages based on assignment status
    let notificationTitle, notificationMessage;
    if (isAssigned) {
      notificationTitle = `Case Assigned to You`;
      notificationMessage = `You have been automatically assigned to a new ${type} case (Case ID: ${report.caseId})`;
    } else if (isNearest) {
      notificationTitle = `New ${type} Case Alert`;
      notificationMessage = `You are the nearest officer to a new ${type} case`;
    } else {
      notificationTitle = `New ${type} Case Alert`;
      notificationMessage = `New ${type} case assigned to your station`;
    }

    notificationPromises.push(
      Notification.create({
        recipient: officer._id,
        type: isAssigned ? 'CASE_ASSIGNED' : 'NEW_CASE_AVAILABLE',
        title: notificationTitle,
        message: notificationMessage,
        data: {
          reportId: report._id,
          caseId: report.caseId,
          type: report.type,
          isAssigned: isAssigned,
          isNearestOfficer: isNearest
        }
      })
    );

    notificationPromises.push(
      sendOneSignalNotification({
        include_player_ids: [officer.deviceToken],
        headings: { en: notificationTitle },
        message: notificationMessage, // Changed from 'contents' to 'message'
        data: {
          type: isAssigned ? 'CASE_ASSIGNED' : 'NEW_CASE_AVAILABLE',
          reportId: report._id,
          caseId: report.caseId,
          isAssigned: isAssigned,
          isNearestOfficer: isNearest
        }
      })
    );
  }
});

    // Enhanced reporter notification with assignment info
    const reporterMessage = report.assignedOfficer 
      ? `Your ${type} report (Case ID: ${report.caseId}) has been created and assigned to ${assignedStation.name}. An officer has been automatically assigned to your case.`
      : `Your ${type} report (Case ID: ${report.caseId}) has been created and assigned to ${assignedStation.name}`;

    notificationPromises.push(
      Notification.create({
        recipient: req.user.id,
        type: "REPORT_CREATED",
        title: "Report Created",
        message: reporterMessage,
        data: {
          reportId: report._id,
          caseId: report.caseId,
          hasAssignedOfficer: !!report.assignedOfficer
        },
      })
    );

    // Send all notifications
    try {
      await Promise.all(notificationPromises);
    } catch (notificationError) {
      console.error("Notification failed:", notificationError);
    }

    // Get populated report for socket emission
    const populatedReport = await Report.findById(report._id)
      .populate("reporter", "firstName lastName")
      .populate("assignedPoliceStation", "name address")
      .populate("assignedOfficer", "firstName lastName")
      .select({
        type: 1,
        caseId: 1,
        personInvolved: 1,
        location: 1,
        status: 1,
        createdAt: 1,
      });

    // Emit socket events
    const io = getIO();

    // Emit to police station room
    io.to(`policeStation_${assignedStation._id}`).emit(SOCKET_EVENTS.NEW_REPORT, {
      report: populatedReport,
      message: `New ${type} report assigned to your station`,
      eligibleOfficers: eligibleOfficers.map(o => ({
        id: o._id,
        name: `${o.firstName} ${o.lastName}`,
        activeCases: o.assignedCases?.length || 0,
        isNearest: nearestOfficer?.officer._id.equals(o._id),
        isAssigned: report.assignedOfficer && report.assignedOfficer.equals(o._id)
      }))
    });

    // Emit to city admin room
    io.to(`city_${location.address.city}`).emit(SOCKET_EVENTS.NEW_REPORT, {
      report: populatedReport,
      message: `New ${type} report in your city`
    });

    res.status(statusCodes.CREATED).json({
      success: true,
      msg: "Report created successfully",
      data: {
        report: {
          ...report.toObject(),
          caseId: report.caseId
        },
        assignedStation,
        eligibleOfficers: eligibleOfficers.map(o => ({
          id: o._id,
          name: `${o.firstName} ${o.lastName}`,
          activeCases: o.assignedCases?.length || 0,
          isNearest: nearestOfficer?.officer._id.equals(o._id),
          isAssigned: report.assignedOfficer && report.assignedOfficer.equals(o._id)
        })),
        assignmentInfo: {
          type: selectedPoliceStation ? "Manual Selection" : "Automatic Assignment",
          hasAssignedOfficer: !!report.assignedOfficer,
          assignedOfficer: report.assignedOfficer ? {
            id: nearestOfficer?.officer._id || eligibleOfficers.find(o => o._id.equals(report.assignedOfficer))?._id,
            name: nearestOfficer?.officer ? 
              `${nearestOfficer.officer.firstName} ${nearestOfficer.officer.lastName}` : 
              eligibleOfficers.find(o => o._id.equals(report.assignedOfficer)) ? 
                `${eligibleOfficers.find(o => o._id.equals(report.assignedOfficer)).firstName} ${eligibleOfficers.find(o => o._id.equals(report.assignedOfficer)).lastName}` : 
                'Unknown',
            distance: nearestOfficer?.distance,
            assignmentReason: nearestOfficer ? 'Nearest officer' : 'Least busy officer'
          } : null
        }
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
//Updating Status of a Report
exports.updateUserReport = asyncHandler(async (req, res) => {
  try {
    const { reportId } = req.params;
    const { status, followUp } = req.body;
    const userId = req.user.id;

    // Validate required inputs
    if (!status && !followUp) {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: "Status or follow-up note is required",
      });
    }

    // Validate status value if provided
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
    }

    // Find and validate report
    const report = await Report.findById(reportId)
      .populate("reporter", "deviceToken firstName lastName")
      .populate("assignedPoliceStation", "_id name")
      .populate("assignedOfficer", "_id firstName lastName");

    if (!report) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: "Report not found",
      });
    }

    // Check authorization
    const isAuthorized = req.user.roles.some(role => 
      ["police_officer", "police_admin", "city_admin", "super_admin"].includes(role)
    );

    if (!isAuthorized) {
      return res.status(statusCodes.FORBIDDEN).json({
        success: false,
        msg: "Not authorized to update this report",
      });
    }

    // Initialize arrays if they don't exist
    if (!report.followUp) {
      report.followUp = [];
    }
    if (!report.statusHistory) {
      report.statusHistory = [];
    }

    // Update status if provided
    if (status && status !== report.status) {
      report.statusHistory.push({
        previousStatus: report.status,
        newStatus: status,
        updatedBy: userId,
        updatedAt: new Date(),
      });
      report.status = status;
    }

    // Add follow-up if provided
    if (followUp && followUp.trim()) {
      report.followUp.push({
        note: followUp.trim(),
        updatedBy: userId,
        updatedAt: new Date()
      });
    }

    // Save the report
    await report.save();

    // Get updated report with populated fields
    const updatedReport = await Report.findById(reportId)
      .populate("reporter", "deviceToken firstName lastName")
      .populate("assignedPoliceStation", "name")
      .populate("assignedOfficer", "firstName lastName")
      .select({
        caseId: 1,
        status: 1,
        followUp: 1,
        statusHistory: 1,
        updatedAt: 1,
        type: 1
      });

    // Handle notifications safely
    if (report.reporter?.deviceToken) 
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

    // Emit socket event safely
    try {
      const io = getIO();
      io.to(`user_${report.reporter._id}`).emit(SOCKET_EVENTS.REPORT_UPDATED, {
        report: updatedReport,
        message: status ? 'Status updated' : 'Follow-up added'
      });
    } catch (socketError) {
      console.error("Socket emission failed:", socketError);
      // Don't fail the request if socket fails
    }

    return res.status(statusCodes.OK).json({
      success: true,
      msg: status ? "Report status updated successfully" : "Follow-up added successfully",
      data: {
        report: updatedReport,
        changes: {
          statusUpdated: !!status,
          followUpAdded: !!followUp,
          previousStatus: status ? report.statusHistory[report.statusHistory.length - 1]?.previousStatus : null,
          newStatus: status || null
        }
      }
    });

  } catch (error) {
    console.error("Error updating report:", error);
    console.error("Error stack:", error.stack);
    
    // Check for specific error types
    if (error.name === 'ValidationError') {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: "Validation error",
        error: Object.values(error.errors).map(e => e.message).join(', ')
      });
    }

    if (error.name === 'CastError') {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: "Invalid report ID format",
      });
    }

    return res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: "Failed to update report",
      error: error.message,
    });
  }
});

// Get Reports (with filters)
// exports.getReports = asyncHandler(async (req, res) => {
//   try {
//     const {
//       status,
//       type,
//       startDate,
//       endDate,
//       page = 1,
//       limit = 10,
//     } = req.query;
//     let query = {};
//     let sortOptions = { createdAt: -1 };  // Default sort by newest first

//     // Apply filters regardless of role
//     if (status) query.status = status;
//     if (type) query.type = type;
//     if (startDate && endDate) {
//       query.createdAt = {
//         $gte: new Date(startDate),
//         $lte: new Date(endDate),
//       };
//     }

//     // Role-based access control
//     switch (req.user.roles[0]) {
//       case "police_officer":
//       case "police_admin":
//         // Check if user has an assigned police station
//         if (!req.user.policeStation) {
//           return res.status(statusCodes.BAD_REQUEST).json({
//             success: false,
//             msg: "Officer/Admin must be assigned to a police station",
//           });
//         }
        
//         // No filter on query - they can see ALL reports from ALL stations
//         // But we'll sort to prioritize reports from their station
//         sortOptions = {
//           // This creates a field that's -1 if it's their station, 1 otherwise (for sorting)
//           isOwnStation: {
//             $cond: [
//               { $eq: ["$assignedPoliceStation", req.user.policeStation] },
//               -1,  // Their station first
//               1
//             ]
//           },
//           createdAt: -1 // Then by date
//         };
//         break;

//       case "city_admin":
//         // Get all stations in the admin's city
//         const cityStations = await PoliceStation.find({
//           "address.city": req.user.address.city,
//         });
//         query.assignedPoliceStation = {
//           $in: cityStations.map((station) => station._id),
//         };
//         break;

//       case "super_admin":
//         // Can see all reports
//         break;

//       default:
//         return res.status(statusCodes.FORBIDDEN).json({
//           success: false,
//           msg: "Not authorized to view reports",
//         });
//     }

//     // Get paginated reports with appropriate sorting
//     const reports = await Report.find(query)
//       .populate("reporter", "-password")
//       .populate("assignedPoliceStation")
//       .populate("assignedOfficer", "firstName lastName number email")
//       .sort(sortOptions)
//       .skip((page - 1) * limit)
//       .limit(limit);

//     const total = await Report.countDocuments(query);

//     res.status(statusCodes.OK).json({
//       success: true,
//       data: {
//         reports,
//         currentPage: page,
//         totalPages: Math.ceil(total / limit),
//         totalReports: total,
//         hasMore: page * limit < total,
//       },
//     });
//   } catch (error) {
//     console.error("Error getting reports:", error);
//     res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
//       success: false,
//       msg: "Error retrieving reports",
//       error: error.message,
//     });
//   }
// });

// Get Reports (with filters)
exports.getReports = asyncHandler(async (req, res) => {
  console.log('touched getReports endpoint');
  try {
    console.log('=== GET REPORTS REQUEST ===');
    console.log('Query params:', req.query);
    console.log('User info:', {
      id: req.user._id,
      roles: req.user.roles,
      policeStation: req.user.policeStation,
      address: req.user.address
    });

    const {
      status,
      type,
      startDate,
      endDate,
      page = 1,
      limit = 10,
    } = req.query;
    const currentPage = parseInt(page);
    const limitPerPage = parseInt(limit);

    console.log('Pagination params:', { currentPage, limitPerPage });

    // Base match stage for the aggregation pipeline
    let matchStage = {};

    // Apply filters regardless of role
    if (status) matchStage.status = status;
    if (type) matchStage.type = type;
    if (startDate && endDate) {
      matchStage.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    console.log('Base match stage:', JSON.stringify(matchStage, null, 2));

    // Basic authentication check - only authorized roles can view reports
    if (!req.user.roles.some(role => 
      ["police_officer", "police_admin", "city_admin", "super_admin"].includes(role)
    )) {
      console.log('❌ Authorization failed - user roles:', req.user.roles);
      return res.status(statusCodes.FORBIDDEN).json({
        success: false,
        msg: "Not authorized to view reports",
      });
    }

    console.log('✅ Authorization passed');

    // Aggregation pipeline
    const pipeline = [
      { $match: matchStage },
      {
        $lookup: {
          from: "users",
          localField: "reporter",
          foreignField: "_id",
          as: "reporter",
        },
      },
      { $unwind: "$reporter" },
      {
        $lookup: {
          from: "policestations",
          localField: "assignedPoliceStation",
          foreignField: "_id",
          as: "assignedPoliceStation",
        },
      },
      { $unwind: "$assignedPoliceStation" },
      {
        $lookup: {
          from: "users",
          localField: "assignedOfficer",
          foreignField: "_id",
          as: "assignedOfficer",
        },
      },
      { $unwind: { path: "$assignedOfficer", preserveNullAndEmptyArrays: true } },
    ];

    console.log('Base pipeline stages:', pipeline.length);

    // Enhanced role-based sorting with priority system
    if (req.user.roles.includes("police_officer")) {
      console.log('🔵 POLICE OFFICER - Adding priority sorting');
      console.log('Officer ID:', req.user._id);
      console.log('Officer station:', req.user.policeStation);
      
      // Police Officers: Priority order
      // 1. Reports assigned to them personally (highest priority)
      // 2. Reports from their police station
      // 3. All other reports
      const priorityStage = {
        $addFields: {
          priority: {
            $cond: [
              { $eq: ["$assignedOfficer._id", req.user._id] }, 1, // Assigned to them = priority 1
              {
                $cond: [
                  { $eq: ["$assignedPoliceStation._id", req.user.policeStation] }, 2, // Their station = priority 2
                  3 // Other reports = priority 3
                ]
              }
            ]
          }
        }
      };
      
      console.log('Priority stage for officer:', JSON.stringify(priorityStage, null, 2));
      pipeline.push(priorityStage);
      pipeline.push({ $sort: { priority: 1, createdAt: -1 } });

    } else if (req.user.roles.includes("police_admin")) {
      console.log('🟡 POLICE ADMIN - Adding priority sorting');
      console.log('Admin station:', req.user.policeStation);
      console.log('Admin city:', req.user.address?.city);
      
      // Police Admins: Priority order
      // 1. Reports from their police station (highest priority)
      // 2. Reports from their city
      // 3. All other reports
      if (req.user.policeStation) {
        const priorityStage = {
          $addFields: {
            priority: {
              $cond: [
                { $eq: ["$assignedPoliceStation._id", req.user.policeStation] }, 1, // Their station = priority 1
                {
                  $cond: [
                    { $eq: ["$assignedPoliceStation.address.city", req.user.address?.city] }, 2, // Their city = priority 2
                    3 // Other reports = priority 3
                  ]
                }
              ]
            }
          }
        };
        
        console.log('Priority stage for admin:', JSON.stringify(priorityStage, null, 2));
        pipeline.push(priorityStage);
        pipeline.push({ $sort: { priority: 1, createdAt: -1 } });
      } else {
        console.log('⚠️ Police admin has no station assigned - using default sort');
        pipeline.push({ $sort: { createdAt: -1 } });
      }

    } else if (req.user.roles.includes("city_admin")) {
      console.log('🟢 CITY ADMIN - Adding priority sorting');
      console.log('City admin city:', req.user.address?.city);
      
      // City Admins: Priority order
      // 1. Reports from their city (highest priority)
      // 2. All other reports
      if (req.user.address?.city) {
        const priorityStage = {
          $addFields: {
            priority: {
              $cond: [
                { 
                  $or: [
                    { $eq: ["$assignedPoliceStation.address.city", req.user.address.city] },
                    { $eq: ["$location.address.city", req.user.address.city] }
                  ]
                }, 1, // Their city = priority 1
                2 // Other reports = priority 2
              ]
            }
          }
        };
        
        console.log('Priority stage for city admin:', JSON.stringify(priorityStage, null, 2));
        pipeline.push(priorityStage);
        pipeline.push({ $sort: { priority: 1, createdAt: -1 } });
      } else {
        console.log('⚠️ City admin has no city assigned - using default sort');
        pipeline.push({ $sort: { createdAt: -1 } });
      }

    } else if (req.user.roles.includes("super_admin")) {
      console.log('🔴 SUPER ADMIN - Using default sort');
      // Super Admins: Just sort by date (they can see everything equally)
      pipeline.push({ $sort: { createdAt: -1 } });

    } else {
      console.log('🟣 REGULAR USER - Adding priority sorting');
      console.log('User city:', req.user.address?.city);
      
      // Regular users (if any): Priority order
      // 1. Reports from their city (if they have an address)
      // 2. All other reports
      if (req.user.address?.city) {
        const priorityStage = {
          $addFields: {
            priority: {
              $cond: [
                { 
                  $or: [
                    { $eq: ["$assignedPoliceStation.address.city", req.user.address.city] },
                    { $eq: ["$location.address.city", req.user.address.city] }
                  ]
                }, 1, // Their city = priority 1
                2 // Other reports = priority 2
              ]
            }
          }
        };
        
        console.log('Priority stage for regular user:', JSON.stringify(priorityStage, null, 2));
        pipeline.push(priorityStage);
        pipeline.push({ $sort: { priority: 1, createdAt: -1 } });
      } else {
        console.log('⚠️ Regular user has no city - using default sort');
        pipeline.push({ $sort: { createdAt: -1 } });
      }
    }

    // Pagination
    console.log('Adding pagination:', { skip: (currentPage - 1) * limitPerPage, limit: limitPerPage });
    pipeline.push({ $skip: (currentPage - 1) * limitPerPage });
    pipeline.push({ $limit: limitPerPage });

    console.log('Final pipeline length:', pipeline.length);
    console.log('Complete pipeline:', JSON.stringify(pipeline, null, 2));

    // Execute the aggregation pipeline
    console.log('🔄 Executing aggregation pipeline...');
    const reports = await Report.aggregate(pipeline);
    console.log('✅ Aggregation completed, found reports:', reports.length);

    // Get total count for pagination
    console.log('🔄 Getting total count...');
    const total = await Report.countDocuments(matchStage);
    console.log('✅ Total reports count:', total);

    // Log first few reports for debugging
    if (reports.length > 0) {
      console.log('First report sample:', {
        id: reports[0]._id,
        type: reports[0].type,
        priority: reports[0].priority,
        assignedStation: reports[0].assignedPoliceStation?.name,
        assignedOfficer: reports[0].assignedOfficer?.firstName,
        createdAt: reports[0].createdAt
      });
    }

    const responseData = {
      reports,
      currentPage,
      totalPages: Math.ceil(total / limitPerPage),
      totalReports: total,
      hasMore: currentPage * limitPerPage < total,
    };

    console.log('📊 Response metadata:', {
      currentPage: responseData.currentPage,
      totalPages: responseData.totalPages,
      totalReports: responseData.totalReports,
      hasMore: responseData.hasMore,
      reportsInResponse: responseData.reports.length
    });

    console.log('=== GET REPORTS RESPONSE SENT ===');

    res.status(statusCodes.OK).json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    console.error('❌ ERROR in getReports:', error);
    console.error('Error stack:', error.stack);
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

      // Apply role-based restrictions (removed police station restrictions)
      if (userRoles.includes("police_officer")) {
        // Police officers can see ALL reports OR only assigned to them personally
        // Remove station restriction completely
        // query.assignedOfficer = req.user._id; // Uncomment if you want officers to only see their assigned cases
        // No restrictions - officers can see all reports
      } else if (userRoles.includes("police_admin")) {
        // Police admins can see ALL reports (removed station restriction)
        // No restrictions
      } else if (userRoles.includes("city_admin")) {
        // City admins can see ALL reports (removed city restriction)
        // No restrictions
      }
      // Super admins already have no restrictions

      console.log("Query for report details:", JSON.stringify(query, null, 2));
      console.log("User policeStation:", req.user.policeStation);
      console.log("User roles:", userRoles);

      // Full details for officers/admins
      report = await Report.findOne(query)
        .populate("reporter", "firstName lastName number email address")
        .populate("assignedPoliceStation")
        .populate("assignedOfficer")
        .populate("broadcastHistory.publishedBy", "firstName lastName roles")
        .populate("consentUpdateHistory.updatedBy", "firstName lastName")
        .select({
          caseId: 1,
          type: 1,
          personInvolved: 1,
          additionalImages: 1,
          video: 1,
          location: 1,
          status: 1,
          followUp: 1,
          broadcastConsent: 1,
          isPublished: 1,
          consentUpdateHistory: 1,
          broadcastHistory: 1,
          publishSchedule: 1,
          statusHistory: 1,
          createdAt: 1,
          updatedAt: 1,
          reporter: 1,
          assignedPoliceStation: 1,
          assignedOfficer: 1,
        });

    } else if (userId) {
      // Case 2: Report Owner Access - Limited Details
      report = await Report.findOne({
        _id: reportId,
        $or: [{ reporter: userId }, { broadcastConsent: true }]
      })
      .populate("reporter", "firstName lastName number email address")
      .populate("assignedPoliceStation", "name address contactNumber")
      .populate("assignedOfficer", "avatar firstName lastName number")
      .select({
        caseId: 1,
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
        video: 1,
        location: 1,
        status: 1,
        followUp: 1,
        broadcastConsent: 1,
        createdAt: 1,
        updatedAt: 1,
        assignedPoliceStation: 1,
        assignedOfficer: 1
      });
    } else {
      // Case 3: Public Access - Minimal Details
      report = await Report.findOne({
        _id: reportId,
        broadcastConsent: true,
        isPublished: true
      }).select({
        caseId: 1,
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
      console.log("Report not found or access denied:", {
        reportId,
        userId,
        userRoles,
        userPoliceStation: req.user.policeStation
      });
      
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: "Report not found or access denied",
      });
    }

    // Log the response before sending
    console.log("Report details response:", {
      success: true,
      reportId: report._id,
      caseId: report.caseId,
      reportType: report.type, 
      userRole: userRoles[0],
      accessType: userRoles.some(role => ["police_officer", "police_admin", "city_admin", "super_admin"].includes(role)) 
        ? "Admin/Officer (Full Access)" 
        : (userId ? "Report Owner (Limited Access)" : "Public (Minimal Access)"),
      assignedStation: report.assignedPoliceStation?._id || report.assignedPoliceStation,
      userStation: req.user.policeStation
    });

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

    // Basic authorization check - only authorized roles can search reports
    if (!req.user.roles.some(role => 
      ["police_officer", "police_admin", "city_admin", "super_admin"].includes(role)
    )) {
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
          caseId: 1,
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

exports.updateAbsentToMissingReports = asyncHandler(async (req, res) => {
  try {
    // Find all Absent reports
    const absentReports = await Report.find({ type: "Absent" });
    
    let updatedCount = 0;
    
    // Check each report to see if it's been more than 24 hours
    for (const report of absentReports) {
      const timeCheck = isLastSeenMoreThan24Hours(
        report.personInvolved.lastSeenDate,
        report.personInvolved.lastSeentime
      );
      
      if (timeCheck.isMoreThan24Hours) {
        // Update report type to Missing
        report.type = "Missing";
        
        // Add status history entry
        report.statusHistory = report.statusHistory || [];
        report.statusHistory.push({
          previousStatus: report.status,
          newStatus: report.status, // Status remains the same, only type changes
          updatedBy: null, // System update
          updatedAt: new Date(),
          notes: `Automatically updated from Absent to Missing after ${timeCheck.hoursPassed} hours`
        });
        
        await report.save();
        updatedCount++;
        
        // Notify relevant parties
        try {
          // Notify reporter
          if (report.reporter) {
            await Notification.create({
              recipient: report.reporter,
              type: "REPORT_TYPE_UPDATED",
              title: "Report Classification Updated",
              message: `Your Absent Person report has been reclassified as Missing Person as 24+ hours have passed`,
              data: {
                reportId: report._id,
              },
            });
          }
          
          // Notify assigned police station
          if (report.assignedPoliceStation) {
            const policeAdmins = await User.find({
              policeStation: report.assignedPoliceStation,
              roles: "police_admin",
            });
            
            for (const admin of policeAdmins) {
              await Notification.create({
                recipient: admin._id,
                type: "REPORT_TYPE_UPDATED",
                title: "Report Classification Updated",
                message: `An Absent Person report has been reclassified as Missing Person as 24+ hours have passed`,
                data: {
                  reportId: report._id,
                },
              });
            }
          }
        } catch (notificationError) {
          console.error("Failed to send notifications:", notificationError);
        }
      }
    }
    
    res.status(statusCodes.OK).json({
      success: true,
      message: `Updated ${updatedCount} reports from Absent to Missing`,
      data: { updatedCount }
    });
    
  } catch (error) {
    console.error("Error updating absent to missing reports:", error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Error updating reports",
      error: error.message
    });
  }
});

// controllers/reportController.js
// Add this new controller function
// controllers/reportController.js
exports.transferReport = asyncHandler(async (req, res) => {
  try {
    const { reportId } = req.params;
    const { recipientEmail, recipientDepartment, transferNotes } = req.body;

    // Authorization check - only police_admin, city_admin, and super_admin can transfer
    if (!req.user.roles.some(role => 
      ["police_admin", "city_admin", "super_admin"].includes(role)
    )) {
      // Check if user is assigned officer for this report
      const report = await Report.findById(req.params.reportId || req.body.reportId);
      
      if (!report) {
        return res.status(statusCodes.NOT_FOUND).json({
          success: false,
          msg: "Report not found",
        });
      }

      // Allow if user is the assigned officer or belongs to the assigned police station or is a police officer at the station
      const isAssignedOfficer = report.assignedOfficer && report.assignedOfficer.toString() === req.user._id.toString();
      const isStationMember = report.assignedPoliceStation && report.assignedPoliceStation.toString() === req.user.policeStation?.toString();
      const isPoliceOfficer = req.user.roles.includes("police_officer");
      
      if (!isAssignedOfficer && !isStationMember && !isPoliceOfficer) {
        return res.status(statusCodes.FORBIDDEN).json({
          success: false,
          msg: "Only admins, assigned officers, or station police officers can transfer reports",
        });
      }
    }

    // Validate required fields
    if (!recipientEmail || !recipientDepartment) {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: "Recipient email and department are required",
      });
    }

    // Get report with all populated data
    const report = await Report.findById(reportId)
      .populate("reporter", "firstName lastName number email address")
      .populate("assignedPoliceStation", "name address contactNumber")
      .populate("assignedOfficer", "firstName lastName number email")
      .populate("broadcastHistory.publishedBy", "firstName lastName")
      .populate("consentUpdateHistory.updatedBy", "firstName lastName");

    if (!report) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: "Report not found",
      });
    }

    // Check if report is already transferred
    if (report.status === "Transferred") {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: "Report has already been transferred",
      });
    }

    // Prepare media attachments for email
    const emailAttachments = [];
    
    // Add main photo if exists
    if (report.personInvolved.mostRecentPhoto?.url) {
      emailAttachments.push({
        filename: `main_photo_${report.caseId}.jpg`,
        path: report.personInvolved.mostRecentPhoto.url,
        cid: 'mainPhoto'
      });
    }

    // Add additional images if exist
    if (report.additionalImages?.length > 0) {
      report.additionalImages.forEach((image, index) => {
        emailAttachments.push({
          filename: `additional_image_${index + 1}_${report.caseId}.jpg`,
          path: image.url,
          cid: `additionalImage${index + 1}`
        });
      });
    }

    // Add video if exists
    if (report.video?.url) {
      emailAttachments.push({
        filename: `video_${report.caseId}.mp4`,
        path: report.video.url,
        cid: 'reportVideo'
      });
    }

    // Prepare email context with complete report data
    const emailContext = {
      reportId: report._id,
      caseId: report.caseId,
      reportType: report.type,
      transferDate: new Date().toLocaleDateString(),
      transferredBy: `${req.user.firstName} ${req.user.lastName}`,
      transferNotes: transferNotes || 'No additional notes provided',
      recipientDepartment,
      
      // Person involved details
      personName: `${report.personInvolved.firstName} ${report.personInvolved.lastName}`,
      personAge: report.personInvolved.age,
      personGender: report.personInvolved.gender,
      personAlias: report.personInvolved.alias,
      lastSeenDate: report.personInvolved.lastSeenDate,
      lastSeenTime: report.personInvolved.lastSeentime,
      lastKnownLocation: report.personInvolved.lastKnownLocation,
      relationship: report.personInvolved.relationship,
      contactInformation: report.personInvolved.contactInformation,
      
      // Reporter details
      reporterName: `${report.reporter.firstName} ${report.reporter.lastName}`,
      reporterEmail: report.reporter.email,
      reporterPhone: report.reporter.number,
      reporterAddress: report.reporter.address,
      
      // Location details
      location: {
        streetAddress: report.location.address.streetAddress,
        barangay: report.location.address.barangay,
        city: report.location.address.city,
        zipCode: report.location.address.zipCode
      },
      
      // Station details
      assignedStation: report.assignedPoliceStation ? {
        name: report.assignedPoliceStation.name,
        address: report.assignedPoliceStation.address,
        contact: report.assignedPoliceStation.contactNumber
      } : null,
      
      // Officer details
      assignedOfficer: report.assignedOfficer ? {
        name: `${report.assignedOfficer.firstName} ${report.assignedOfficer.lastName}`,
        email: report.assignedOfficer.email,
        phone: report.assignedOfficer.number
      } : null,
      
      // Case details
      createdAt: report.createdAt,
      currentStatus: report.status,
      followUpNotes: report.followUp || [],
      statusHistory: report.statusHistory || [],
      
      // Additional information
      personDescription: {
        height: report.personInvolved.height,
        weight: report.personInvolved.weight,
        eyeColor: report.personInvolved.eyeColor,
        hairColor: report.personInvolved.hairColor,
        scarsMarksTattoos: report.personInvolved.scarsMarksTattoos,
        lastKnownClothing: report.personInvolved.lastKnownClothing,
        medications: report.personInvolved.medications,
        otherInformation: report.personInvolved.otherInformation
      },
      
      // Media info for template
      hasMainPhoto: !!report.personInvolved.mostRecentPhoto?.url,
      additionalImagesCount: report.additionalImages?.length || 0,
      hasVideo: !!report.video?.url,
      
      // Media arrays for template iteration
      additionalImages: report.additionalImages || [],
      mainPhotoUrl: report.personInvolved.mostRecentPhoto?.url,
      videoUrl: report.video?.url
    };

    // Send transfer email with attachments
    const emailResult = await sendTransferEmailWithAttachments(
      emailContext,
      [recipientEmail],
      emailAttachments
    );

    if (!emailResult.success) {
      return res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        msg: "Failed to send transfer email",
        error: emailResult.error
      });
    }

    // Update report status and add transfer information
    report.status = "Transferred";
    
    // Add to status history
    report.statusHistory = report.statusHistory || [];
    report.statusHistory.push({
      previousStatus: report.status,
      newStatus: "Transferred",
      updatedBy: req.user._id,
      updatedAt: new Date(),
      notes: `Transferred to ${recipientDepartment} (${recipientEmail}): ${transferNotes || 'No notes'}`
    });

    // Add transfer record
    report.transferHistory = report.transferHistory || [];
    report.transferHistory.push({
      transferredTo: recipientEmail,
      department: recipientDepartment,
      transferredBy: req.user._id,
      transferDate: new Date(),
      notes: transferNotes
    });

    await report.save();

    // Delete images from Cloudinary
    const cloudinary = require("cloudinary").v2;
    const deletePromises = [];

    // Delete main photo
    if (report.personInvolved.mostRecentPhoto?.public_id) {
      deletePromises.push(
        cloudinary.uploader.destroy(report.personInvolved.mostRecentPhoto.public_id)
      );
    }

    // Delete additional images
    if (report.additionalImages?.length > 0) {
      report.additionalImages.forEach(image => {
        if (image.public_id) {
          deletePromises.push(
            cloudinary.uploader.destroy(image.public_id)
          );
        }
      });
    }

    // Delete video
    if (report.video?.public_id) {
      deletePromises.push(
        cloudinary.uploader.destroy(report.video.public_id, { resource_type: "video" })
      );
    }

    // Execute all deletions
    try {
      await Promise.allSettled(deletePromises);
      console.log(`Deleted ${deletePromises.length} media files from Cloudinary for report ${report.caseId}`);
    } catch (cloudinaryError) {
      console.error("Error deleting media from Cloudinary:", cloudinaryError);
    }

    // Delete the report from database
    await Report.findByIdAndDelete(reportId);

    // Notify relevant parties about the transfer
    const notificationPromises = [];

    // Notify reporter
    if (report.reporter?.deviceToken) {
      notificationPromises.push(
        sendOneSignalNotification({
          include_player_ids: [report.reporter.deviceToken],
          headings: { en: "Report Transferred" },
          contents: {
            en: `Your report has been transferred to ${recipientDepartment} for further handling.`,
          },
          data: {
            type: "REPORT_TRANSFERRED",
            reportId: report._id,
            department: recipientDepartment,
          },
        })
      );
    }

    // Notify assigned officer if exists
    if (report.assignedOfficer?.deviceToken) {
      notificationPromises.push(
        sendOneSignalNotification({
          include_player_ids: [report.assignedOfficer.deviceToken],
          headings: { en: "Case Transferred" },
          contents: {
            en: `The case you were handling has been transferred to ${recipientDepartment}.`,
          },
          data: {
            type: "CASE_TRANSFERRED",
            reportId: report._id,
            department: recipientDepartment,
          },
        })
      );
    }

    // Send notifications
    await Promise.allSettled(notificationPromises);

    res.status(statusCodes.OK).json({
      success: true,
      msg: `Report successfully transferred to ${recipientDepartment} and data has been deleted`,
      data: {
        transferredTo: recipientEmail,
        department: recipientDepartment,
        transferDate: new Date(),
        emailSent: emailResult.success,
        mediaFilesDeleted: deletePromises.length,
        mediaFilesAttached: emailAttachments.length,
        reportDeleted: true
      }
    });

  } catch (error) {
    console.error("Error transferring report:", error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: "Error transferring report",
      error: error.message,
    });
  }
});

exports.archiveResolvedReports = asyncHandler(async (req, res) => {
  try {
    const { recipientEmail, startDate, endDate, policeStationId, includeImages = true } = req.body;

    // Authorization check - only admins can archive reports
    if (!req.user.roles.some(role => 
      ["police_admin", "city_admin", "super_admin"].includes(role)
    )) {
      return res.status(statusCodes.FORBIDDEN).json({
        success: false,
        msg: "Only admins can archive resolved reports",
      });
    }

    // Validate required fields
    if (!recipientEmail) {
      return res.status(statusCodes.BAD_REQUEST).json({
        success: false,
        msg: "Recipient email is required",
      });
    }

    // Build query for resolved reports
    let query = { status: "Resolved" };
    
    // Add date range filter
    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    // Add police station filter
    if (policeStationId) {
      // Validate police station exists
      const policeStation = await PoliceStation.findById(policeStationId);
      if (!policeStation) {
        return res.status(statusCodes.NOT_FOUND).json({
          success: false,
          msg: "Police station not found",
        });
      }
      
      query.assignedPoliceStation = policeStationId;
    }

    // Get all resolved reports with populated data
    const resolvedReports = await Report.find(query)
      .populate("reporter", "firstName lastName number email address")
      .populate("assignedPoliceStation", "name address contactNumber")
      .populate("assignedOfficer", "firstName lastName number email")
      .sort("-createdAt");

    if (resolvedReports.length === 0) {
      return res.status(statusCodes.NOT_FOUND).json({
        success: false,
        msg: "No resolved reports found for the specified criteria",
      });
    }

    console.log(`Found ${resolvedReports.length} resolved reports to archive`);

    // Get police station name for context (if filtered by station)
    let policeStationName = null;
    if (policeStationId) {
      const station = await PoliceStation.findById(policeStationId);
      policeStationName = station?.name || 'Unknown Station';
    }

    // Create Excel workbook
    const ExcelJS = require('exceljs');

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Resolved Reports');

    // Define columns (removed photo/video columns, added note column)
    worksheet.columns = [
      { header: 'Case ID', key: 'caseId', width: 15 },
      { header: 'Report Type', key: 'type', width: 15 },
      { header: 'Person Name', key: 'personName', width: 25 },
      { header: 'Age', key: 'age', width: 10 },
      { header: 'Gender', key: 'gender', width: 10 },
      { header: 'Last Seen Date', key: 'lastSeenDate', width: 15 },
      { header: 'Last Seen Time', key: 'lastSeenTime', width: 15 },
      { header: 'Location', key: 'location', width: 30 },
      { header: 'Reporter Name', key: 'reporterName', width: 25 },
      { header: 'Reporter Email', key: 'reporterEmail', width: 30 },
      { header: 'Reporter Phone', key: 'reporterPhone', width: 15 },
      { header: 'Assigned Station', key: 'assignedStation', width: 25 },
      { header: 'Assigned Officer', key: 'assignedOfficer', width: 25 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Created Date', key: 'createdAt', width: 20 },
      { header: 'Resolved Date', key: 'resolvedAt', width: 20 },
      { header: 'Media Files Note', key: 'mediaNote', width: 30 },
    ];

    // Style the header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '2C3E50' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

    // Count total media files
    let totalMediaFiles = 0;

    // Process each report
    for (let i = 0; i < resolvedReports.length; i++) {
      const report = resolvedReports[i];
      
      // Find resolved date from status history
      const resolvedEntry = report.statusHistory?.find(entry => entry.newStatus === "Resolved");
      const resolvedAt = resolvedEntry ? resolvedEntry.updatedAt : report.updatedAt;

      // Count media files for this report
      let mediaCount = 0;
      let mediaTypes = [];
      
      if (report.personInvolved.mostRecentPhoto?.url) {
        mediaCount++;
        mediaTypes.push('Main Photo');
        totalMediaFiles++;
      }
      
      if (report.additionalImages?.length > 0) {
        mediaCount += report.additionalImages.length;
        mediaTypes.push(`${report.additionalImages.length} Additional Images`);
        totalMediaFiles += report.additionalImages.length;
      }
      
      if (report.video?.url) {
        mediaCount++;
        mediaTypes.push('Video');
        totalMediaFiles++;
      }

      // Prepare row data
      const rowData = {
        caseId: report.caseId || `${report.type.substring(0, 3).toUpperCase()}-${report._id.toString().slice(-7)}`,
        type: report.type,
        personName: `${report.personInvolved.firstName} ${report.personInvolved.lastName}`,
        age: report.personInvolved.age,
        gender: report.personInvolved.gender,
        lastSeenDate: report.personInvolved.lastSeenDate ? new Date(report.personInvolved.lastSeenDate).toLocaleDateString() : '',
        lastSeenTime: report.personInvolved.lastSeentime || '',
        location: `${report.location.address.streetAddress}, ${report.location.address.barangay}, ${report.location.address.city}`,
        reporterName: `${report.reporter.firstName} ${report.reporter.lastName}`,
        reporterEmail: report.reporter.email,
        reporterPhone: report.reporter.number,
        assignedStation: report.assignedPoliceStation?.name || 'Not assigned',
        assignedOfficer: report.assignedOfficer ? `${report.assignedOfficer.firstName} ${report.assignedOfficer.lastName}` : 'Not assigned',
        status: report.status,
        createdAt: new Date(report.createdAt).toLocaleDateString(),
        resolvedAt: new Date(resolvedAt).toLocaleDateString(),
        mediaNote: mediaCount > 0 ? 
          `${mediaCount} files: ${mediaTypes.join(', ')} - See email for images` : 
          'No media files'
      };

      // Add row to worksheet
      worksheet.addRow(rowData);
    }

    // Add a note at the top about media files
    worksheet.insertRow(1, {
      caseId: 'NOTE:',
      type: 'Media files (photos/videos) are embedded in the email below.',
      personName: 'This Excel file contains only text data.',
      age: '',
      gender: '',
      lastSeenDate: '',
      lastSeenTime: '',
      location: '',
      reporterName: '',
      reporterEmail: '',
      reporterPhone: '',
      assignedStation: '',
      assignedOfficer: '',
      status: '',
      createdAt: '',
      resolvedAt: '',
      mediaNote: 'Check email content for images'
    });

    // Style the note row
    const noteRow = worksheet.getRow(1);
    noteRow.font = { bold: true, color: { argb: 'FF0000' } };
    noteRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF99' } };

    // Re-style the header row (now row 2)
    const newHeaderRow = worksheet.getRow(2);
    newHeaderRow.font = { bold: true, color: { argb: 'FFFFFF' } };
    newHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '2C3E50' } };
    newHeaderRow.alignment = { horizontal: 'center', vertical: 'middle' };

    // Apply alternating row colors (starting from row 3)
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > 2) { // Skip note and header rows
        if (rowNumber % 2 === 1) { // Odd rows (excluding header)
          row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8F9FA' } };
        }
      }
    });

    // Auto-fit columns
    worksheet.columns.forEach(column => {
      column.width = Math.max(column.width, 10);
    });

    // Generate Excel buffer
    const excelBuffer = await workbook.xlsx.writeBuffer();

    // Prepare reports data for email template
    const reportsWithMedia = resolvedReports.map(report => {
      const resolvedEntry = report.statusHistory?.find(entry => entry.newStatus === "Resolved");
      const resolvedAt = resolvedEntry ? resolvedEntry.updatedAt : report.updatedAt;
      
      return {
        caseId: report.caseId || `${report.type.substring(0, 3).toUpperCase()}-${report._id.toString().slice(-7)}`,
        type: report.type,
        personName: `${report.personInvolved.firstName} ${report.personInvolved.lastName}`,
        age: report.personInvolved.age,
        gender: report.personInvolved.gender,
        lastSeenDate: report.personInvolved.lastSeenDate ? new Date(report.personInvolved.lastSeenDate).toLocaleDateString() : '',
        lastSeenTime: report.personInvolved.lastSeentime || '',
        location: `${report.location.address.streetAddress}, ${report.location.address.barangay}, ${report.location.address.city}`,
        reporterName: `${report.reporter.firstName} ${report.reporter.lastName}`,
        reporterEmail: report.reporter.email,
        reporterPhone: report.reporter.number,
        assignedStation: report.assignedPoliceStation?.name || 'Not assigned',
        assignedOfficer: report.assignedOfficer ? `${report.assignedOfficer.firstName} ${report.assignedOfficer.lastName}` : 'Not assigned',
        createdAt: new Date(report.createdAt).toLocaleDateString(),
        resolvedAt: new Date(resolvedAt).toLocaleDateString(),
        mainPhoto: report.personInvolved.mostRecentPhoto?.url || null,
        additionalImages: report.additionalImages || [],
        video: report.video?.url || null,
        hasMedia: !!(report.personInvolved.mostRecentPhoto?.url || report.additionalImages?.length > 0 || report.video?.url)
      };
    });

    // Email context with police station info
    const emailContext = {
      totalReports: resolvedReports.length,
      dateRange: startDate && endDate ? `${new Date(startDate).toLocaleDateString()} to ${new Date(endDate).toLocaleDateString()}` : 'All time',
      policeStationFilter: policeStationName || 'All stations',
      generatedBy: `${req.user.firstName} ${req.user.lastName}`,
      generatedDate: new Date().toLocaleDateString(),
      includesImages: includeImages,
      totalMediaFiles: totalMediaFiles,
      reports: reportsWithMedia
    };

    // Email attachments (only Excel file)
    const emailAttachments = [{
      filename: `Resolved_Reports_Archive_${policeStationName ? `${policeStationName.replace(/\s+/g, '_')}_` : ''}${new Date().toISOString().split('T')[0]}.xlsx`,
      content: excelBuffer,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }];

    // Send email
    const emailResult = await sendArchiveEmailWithImages(
      emailContext,
      [recipientEmail],
      emailAttachments
    );

    if (!emailResult.success) {
      return res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        msg: "Failed to send archive email",
        error: emailResult.error
      });
    }

    // After successful email, delete media from Cloudinary and delete reports
    const cloudinary = require("cloudinary").v2;
    const deletePromises = [];

    // Delete all media files from Cloudinary for each report
    for (const report of resolvedReports) {
      // Delete main photo
      if (report.personInvolved.mostRecentPhoto?.public_id) {
        deletePromises.push(
          cloudinary.uploader.destroy(report.personInvolved.mostRecentPhoto.public_id)
        );
      }

      // Delete additional images
      if (report.additionalImages?.length > 0) {
        report.additionalImages.forEach(image => {
          if (image.public_id) {
            deletePromises.push(
              cloudinary.uploader.destroy(image.public_id)
            );
          }
        });
      }

      // Delete video
      if (report.video?.public_id) {
        deletePromises.push(
          cloudinary.uploader.destroy(report.video.public_id, { resource_type: "video" })
        );
      }
    }

    // Execute all media deletions
    try {
      await Promise.allSettled(deletePromises);
      console.log(`Deleted ${deletePromises.length} media files from Cloudinary`);
    } catch (cloudinaryError) {
      console.error("Error deleting media from Cloudinary:", cloudinaryError);
    }

    // Delete all reports from database
    await Report.deleteMany({ _id: { $in: resolvedReports.map(r => r._id) } });

    res.status(statusCodes.OK).json({
      success: true,
      msg: `Successfully archived and deleted ${resolvedReports.length} resolved reports${policeStationName ? ` from ${policeStationName}` : ''}`,
      data: {
        reportsArchived: resolvedReports.length,
        reportsDeleted: resolvedReports.length,
        emailSent: emailResult.success,
        recipientEmail,
        dateRange: emailContext.dateRange,
        policeStationFilter: policeStationName || 'All stations',
        includesImages: includeImages,
        totalMediaFiles: totalMediaFiles,
        mediaFilesDeleted: deletePromises.length,
        mediaIncludedInEmail: true
      }
    });

  } catch (error) {
    console.error("Error archiving resolved reports:", error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: "Error archiving resolved reports",
      error: error.message,
    });
  }
});
// exports.archiveResolvedReports = asyncHandler(async (req, res) => {
//   try {
//     const { recipientEmail, startDate, endDate, policeStationId, includeImages = true } = req.body;

//     // Authorization check - only admins can archive reports
//     if (!req.user.roles.some(role => 
//       ["police_admin", "city_admin", "super_admin"].includes(role)
//     )) {
//       return res.status(statusCodes.FORBIDDEN).json({
//         success: false,
//         msg: "Only admins can archive resolved reports",
//       });
//     }

//     // Validate required fields
//     if (!recipientEmail) {
//       return res.status(statusCodes.BAD_REQUEST).json({
//         success: false,
//         msg: "Recipient email is required",
//       });
//     }

//     // Build query for resolved reports
//     let query = { status: "Resolved" };
    
//     // Add date range filter
//     if (startDate && endDate) {
//       query.createdAt = {
//         $gte: new Date(startDate),
//         $lte: new Date(endDate)
//       };
//     }

//     // Add police station filter
//     if (policeStationId) {
//       // Validate police station exists
//       const policeStation = await PoliceStation.findById(policeStationId);
//       if (!policeStation) {
//         return res.status(statusCodes.NOT_FOUND).json({
//           success: false,
//           msg: "Police station not found",
//         });
//       }
      
//       query.assignedPoliceStation = policeStationId;
//     }

//     // Get all resolved reports with populated data
//     const resolvedReports = await Report.find(query)
//       .populate("reporter", "firstName lastName number email address")
//       .populate("assignedPoliceStation", "name address contactNumber")
//       .populate("assignedOfficer", "firstName lastName number email")
//       .sort("-createdAt");

//     if (resolvedReports.length === 0) {
//       return res.status(statusCodes.NOT_FOUND).json({
//         success: false,
//         msg: "No resolved reports found for the specified criteria",
//       });
//     }

//     console.log(`Found ${resolvedReports.length} resolved reports to archive`);

//     // Get police station name for context (if filtered by station)
//     let policeStationName = null;
//     if (policeStationId) {
//       const station = await PoliceStation.findById(policeStationId);
//       policeStationName = station?.name || 'Unknown Station';
//     }

//     // Create Excel workbook
//     const ExcelJS = require('exceljs');

//     const workbook = new ExcelJS.Workbook();
//     const worksheet = workbook.addWorksheet('Resolved Reports');

//     // Define columns (removed photo/video columns, added note column)
//     worksheet.columns = [
//       { header: 'Case ID', key: 'caseId', width: 15 },
//       { header: 'Report Type', key: 'type', width: 15 },
//       { header: 'Person Name', key: 'personName', width: 25 },
//       { header: 'Age', key: 'age', width: 10 },
//       { header: 'Gender', key: 'gender', width: 10 },
//       { header: 'Last Seen Date', key: 'lastSeenDate', width: 15 },
//       { header: 'Last Seen Time', key: 'lastSeenTime', width: 15 },
//       { header: 'Location', key: 'location', width: 30 },
//       { header: 'Reporter Name', key: 'reporterName', width: 25 },
//       { header: 'Reporter Email', key: 'reporterEmail', width: 30 },
//       { header: 'Reporter Phone', key: 'reporterPhone', width: 15 },
//       { header: 'Assigned Station', key: 'assignedStation', width: 25 },
//       { header: 'Assigned Officer', key: 'assignedOfficer', width: 25 },
//       { header: 'Status', key: 'status', width: 15 },
//       { header: 'Created Date', key: 'createdAt', width: 20 },
//       { header: 'Resolved Date', key: 'resolvedAt', width: 20 },
//       { header: 'Media Files Note', key: 'mediaNote', width: 30 },
//     ];

//     // Style the header row
//     const headerRow = worksheet.getRow(1);
//     headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
//     headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '2C3E50' } };
//     headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

//     // Count total media files
//     let totalMediaFiles = 0;

//     // Process each report
//     for (let i = 0; i < resolvedReports.length; i++) {
//       const report = resolvedReports[i];
      
//       // Find resolved date from status history
//       const resolvedEntry = report.statusHistory?.find(entry => entry.newStatus === "Resolved");
//       const resolvedAt = resolvedEntry ? resolvedEntry.updatedAt : report.updatedAt;

//       // Count media files for this report
//       let mediaCount = 0;
//       let mediaTypes = [];
      
//       if (report.personInvolved.mostRecentPhoto?.url) {
//         mediaCount++;
//         mediaTypes.push('Main Photo');
//         totalMediaFiles++;
//       }
      
//       if (report.additionalImages?.length > 0) {
//         mediaCount += report.additionalImages.length;
//         mediaTypes.push(`${report.additionalImages.length} Additional Images`);
//         totalMediaFiles += report.additionalImages.length;
//       }
      
//       if (report.video?.url) {
//         mediaCount++;
//         mediaTypes.push('Video');
//         totalMediaFiles++;
//       }

//       // Prepare row data
//       const rowData = {
//         caseId: report.caseId || `${report.type.substring(0, 3).toUpperCase()}-${report._id.toString().slice(-7)}`,
//         type: report.type,
//         personName: `${report.personInvolved.firstName} ${report.personInvolved.lastName}`,
//         age: report.personInvolved.age,
//         gender: report.personInvolved.gender,
//         lastSeenDate: report.personInvolved.lastSeenDate ? new Date(report.personInvolved.lastSeenDate).toLocaleDateString() : '',
//         lastSeenTime: report.personInvolved.lastSeentime || '',
//         location: `${report.location.address.streetAddress}, ${report.location.address.barangay}, ${report.location.address.city}`,
//         reporterName: `${report.reporter.firstName} ${report.reporter.lastName}`,
//         reporterEmail: report.reporter.email,
//         reporterPhone: report.reporter.number,
//         assignedStation: report.assignedPoliceStation?.name || 'Not assigned',
//         assignedOfficer: report.assignedOfficer ? `${report.assignedOfficer.firstName} ${report.assignedOfficer.lastName}` : 'Not assigned',
//         status: report.status,
//         createdAt: new Date(report.createdAt).toLocaleDateString(),
//         resolvedAt: new Date(resolvedAt).toLocaleDateString(),
//         mediaNote: mediaCount > 0 ? 
//           `${mediaCount} files: ${mediaTypes.join(', ')} - See email for images` : 
//           'No media files'
//       };

//       // Add row to worksheet
//       worksheet.addRow(rowData);
//     }

//     // Add a note at the top about media files
//     worksheet.insertRow(1, {
//       caseId: 'NOTE:',
//       type: 'Media files (photos/videos) are embedded in the email below.',
//       personName: 'This Excel file contains only text data.',
//       age: '',
//       gender: '',
//       lastSeenDate: '',
//       lastSeenTime: '',
//       location: '',
//       reporterName: '',
//       reporterEmail: '',
//       reporterPhone: '',
//       assignedStation: '',
//       assignedOfficer: '',
//       status: '',
//       createdAt: '',
//       resolvedAt: '',
//       mediaNote: 'Check email content for images'
//     });

//     // Style the note row
//     const noteRow = worksheet.getRow(1);
//     noteRow.font = { bold: true, color: { argb: 'FF0000' } };
//     noteRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF99' } };

//     // Re-style the header row (now row 2)
//     const newHeaderRow = worksheet.getRow(2);
//     newHeaderRow.font = { bold: true, color: { argb: 'FFFFFF' } };
//     newHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '2C3E50' } };
//     newHeaderRow.alignment = { horizontal: 'center', vertical: 'middle' };

//     // Apply alternating row colors (starting from row 3)
//     worksheet.eachRow((row, rowNumber) => {
//       if (rowNumber > 2) { // Skip note and header rows
//         if (rowNumber % 2 === 1) { // Odd rows (excluding header)
//           row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8F9FA' } };
//         }
//       }
//     });

//     // Auto-fit columns
//     worksheet.columns.forEach(column => {
//       column.width = Math.max(column.width, 10);
//     });

//     // Generate Excel buffer
//     const excelBuffer = await workbook.xlsx.writeBuffer();

//     // Prepare reports data for email template
//     const reportsWithMedia = resolvedReports.map(report => {
//       const resolvedEntry = report.statusHistory?.find(entry => entry.newStatus === "Resolved");
//       const resolvedAt = resolvedEntry ? resolvedEntry.updatedAt : report.updatedAt;
      
//       return {
//         caseId: report.caseId || `${report.type.substring(0, 3).toUpperCase()}-${report._id.toString().slice(-7)}`,
//         type: report.type,
//         personName: `${report.personInvolved.firstName} ${report.personInvolved.lastName}`,
//         age: report.personInvolved.age,
//         gender: report.personInvolved.gender,
//         lastSeenDate: report.personInvolved.lastSeenDate ? new Date(report.personInvolved.lastSeenDate).toLocaleDateString() : '',
//         lastSeenTime: report.personInvolved.lastSeentime || '',
//         location: `${report.location.address.streetAddress}, ${report.location.address.barangay}, ${report.location.address.city}`,
//         reporterName: `${report.reporter.firstName} ${report.reporter.lastName}`,
//         reporterEmail: report.reporter.email,
//         reporterPhone: report.reporter.number,
//         assignedStation: report.assignedPoliceStation?.name || 'Not assigned',
//         assignedOfficer: report.assignedOfficer ? `${report.assignedOfficer.firstName} ${report.assignedOfficer.lastName}` : 'Not assigned',
//         createdAt: new Date(report.createdAt).toLocaleDateString(),
//         resolvedAt: new Date(resolvedAt).toLocaleDateString(),
//         mainPhoto: report.personInvolved.mostRecentPhoto?.url || null,
//         additionalImages: report.additionalImages || [],
//         video: report.video?.url || null,
//         hasMedia: !!(report.personInvolved.mostRecentPhoto?.url || report.additionalImages?.length > 0 || report.video?.url)
//       };
//     });

//     // Email context with police station info
//     const emailContext = {
//       totalReports: resolvedReports.length,
//       dateRange: startDate && endDate ? `${new Date(startDate).toLocaleDateString()} to ${new Date(endDate).toLocaleDateString()}` : 'All time',
//       policeStationFilter: policeStationName || 'All stations',
//       generatedBy: `${req.user.firstName} ${req.user.lastName}`,
//       generatedDate: new Date().toLocaleDateString(),
//       includesImages: includeImages,
//       totalMediaFiles: totalMediaFiles,
//       reports: reportsWithMedia
//     };

//     // Email attachments (only Excel file)
//     const emailAttachments = [{
//       filename: `Resolved_Reports_Archive_${policeStationName ? `${policeStationName.replace(/\s+/g, '_')}_` : ''}${new Date().toISOString().split('T')[0]}.xlsx`,
//       content: excelBuffer,
//       contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
//     }];

//     // Send email
//     const emailResult = await sendArchiveEmailWithImages(
//       emailContext,
//       [recipientEmail],
//       emailAttachments
//     );

//     if (!emailResult.success) {
//       return res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
//         success: false,
//         msg: "Failed to send archive email",
//         error: emailResult.error
//       });
//     }

//     // After successful email, update reports status to Archived
//     await Report.updateMany(
//       { _id: { $in: resolvedReports.map(r => r._id) } },
//       { 
//         status: "Archived",
//         archivedAt: new Date(),
//         archivedBy: req.user._id
//       }
//     );

//     res.status(statusCodes.OK).json({
//       success: true,
//       msg: `Successfully archived ${resolvedReports.length} resolved reports${policeStationName ? ` from ${policeStationName}` : ''}`,
//       data: {
//         reportsArchived: resolvedReports.length,
//         emailSent: emailResult.success,
//         recipientEmail,
//         dateRange: emailContext.dateRange,
//         policeStationFilter: policeStationName || 'All stations',
//         includesImages: includeImages,
//         totalMediaFiles: totalMediaFiles,
//         mediaIncludedInEmail: true
//       }
//     });

//   } catch (error) {
//     console.error("Error archiving resolved reports:", error);
//     res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
//       success: false,
//       msg: "Error archiving resolved reports",
//       error: error.message,
//     });
//   }
// });

// exports.archiveResolvedReports = asyncHandler(async (req, res) => {
//   try {
//     const { recipientEmail, startDate, endDate, includeImages = true } = req.body;

//     // Authorization check - only admins can archive reports
//     if (!req.user.roles.some(role => 
//       ["police_admin", "city_admin", "super_admin"].includes(role)
//     )) {
//       return res.status(statusCodes.FORBIDDEN).json({
//         success: false,
//         msg: "Only admins can archive resolved reports",
//       });
//     }

//     // Validate required fields
//     if (!recipientEmail) {
//       return res.status(statusCodes.BAD_REQUEST).json({
//         success: false,
//         msg: "Recipient email is required",
//       });
//     }

//     // Build query for resolved reports
//     let query = { status: "Resolved" };
    
//     if (startDate && endDate) {
//       query.createdAt = {
//         $gte: new Date(startDate),
//         $lte: new Date(endDate)
//       };
//     }

//     // Get all resolved reports with populated data
//     const resolvedReports = await Report.find(query)
//       .populate("reporter", "firstName lastName number email address")
//       .populate("assignedPoliceStation", "name address contactNumber")
//       .populate("assignedOfficer", "firstName lastName number email")
//       .sort("-createdAt");

//     if (resolvedReports.length === 0) {
//       return res.status(statusCodes.NOT_FOUND).json({
//         success: false,
//         msg: "No resolved reports found for the specified criteria",
//       });
//     }

//     console.log(`Found ${resolvedReports.length} resolved reports to archive`);

//     // Create Excel workbook
//     const ExcelJS = require('exceljs');

//     const workbook = new ExcelJS.Workbook();
//     const worksheet = workbook.addWorksheet('Resolved Reports');

//     // Define columns (removed photo/video columns, added note column)
//     worksheet.columns = [
//       { header: 'Case ID', key: 'caseId', width: 15 },
//       { header: 'Report Type', key: 'type', width: 15 },
//       { header: 'Person Name', key: 'personName', width: 25 },
//       { header: 'Age', key: 'age', width: 10 },
//       { header: 'Gender', key: 'gender', width: 10 },
//       { header: 'Last Seen Date', key: 'lastSeenDate', width: 15 },
//       { header: 'Last Seen Time', key: 'lastSeenTime', width: 15 },
//       { header: 'Location', key: 'location', width: 30 },
//       { header: 'Reporter Name', key: 'reporterName', width: 25 },
//       { header: 'Reporter Email', key: 'reporterEmail', width: 30 },
//       { header: 'Reporter Phone', key: 'reporterPhone', width: 15 },
//       { header: 'Assigned Station', key: 'assignedStation', width: 25 },
//       { header: 'Assigned Officer', key: 'assignedOfficer', width: 25 },
//       { header: 'Status', key: 'status', width: 15 },
//       { header: 'Created Date', key: 'createdAt', width: 20 },
//       { header: 'Resolved Date', key: 'resolvedAt', width: 20 },
//       { header: 'Media Files Note', key: 'mediaNote', width: 30 },
//     ];

//     // Style the header row
//     const headerRow = worksheet.getRow(1);
//     headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
//     headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '2C3E50' } };
//     headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

//     // Count total media files
//     let totalMediaFiles = 0;

//     // Process each report
//     for (let i = 0; i < resolvedReports.length; i++) {
//       const report = resolvedReports[i];
      
//       // Find resolved date from status history
//       const resolvedEntry = report.statusHistory?.find(entry => entry.newStatus === "Resolved");
//       const resolvedAt = resolvedEntry ? resolvedEntry.updatedAt : report.updatedAt;

//       // Count media files for this report
//       let mediaCount = 0;
//       let mediaTypes = [];
      
//       if (report.personInvolved.mostRecentPhoto?.url) {
//         mediaCount++;
//         mediaTypes.push('Main Photo');
//         totalMediaFiles++;
//       }
      
//       if (report.additionalImages?.length > 0) {
//         mediaCount += report.additionalImages.length;
//         mediaTypes.push(`${report.additionalImages.length} Additional Images`);
//         totalMediaFiles += report.additionalImages.length;
//       }
      
//       if (report.video?.url) {
//         mediaCount++;
//         mediaTypes.push('Video');
//         totalMediaFiles++;
//       }

//       // Prepare row data
//       const rowData = {
//         caseId: report.caseId || `${report.type.substring(0, 3).toUpperCase()}-${report._id.toString().slice(-7)}`,
//         type: report.type,
//         personName: `${report.personInvolved.firstName} ${report.personInvolved.lastName}`,
//         age: report.personInvolved.age,
//         gender: report.personInvolved.gender,
//         lastSeenDate: report.personInvolved.lastSeenDate ? new Date(report.personInvolved.lastSeenDate).toLocaleDateString() : '',
//         lastSeenTime: report.personInvolved.lastSeentime || '',
//         location: `${report.location.address.streetAddress}, ${report.location.address.barangay}, ${report.location.address.city}`,
//         reporterName: `${report.reporter.firstName} ${report.reporter.lastName}`,
//         reporterEmail: report.reporter.email,
//         reporterPhone: report.reporter.number,
//         assignedStation: report.assignedPoliceStation?.name || 'Not assigned',
//         assignedOfficer: report.assignedOfficer ? `${report.assignedOfficer.firstName} ${report.assignedOfficer.lastName}` : 'Not assigned',
//         status: report.status,
//         createdAt: new Date(report.createdAt).toLocaleDateString(),
//         resolvedAt: new Date(resolvedAt).toLocaleDateString(),
//         mediaNote: mediaCount > 0 ? 
//           `${mediaCount} files: ${mediaTypes.join(', ')} - See email for images` : 
//           'No media files'
//       };

//       // Add row to worksheet
//       worksheet.addRow(rowData);
//     }

//     // Add a note at the top about media files
//     worksheet.insertRow(1, {
//       caseId: 'NOTE:',
//       type: 'Media files (photos/videos) are embedded in the email below.',
//       personName: 'This Excel file contains only text data.',
//       age: '',
//       gender: '',
//       lastSeenDate: '',
//       lastSeenTime: '',
//       location: '',
//       reporterName: '',
//       reporterEmail: '',
//       reporterPhone: '',
//       assignedStation: '',
//       assignedOfficer: '',
//       status: '',
//       createdAt: '',
//       resolvedAt: '',
//       mediaNote: 'Check email content for images'
//     });

//     // Style the note row
//     const noteRow = worksheet.getRow(1);
//     noteRow.font = { bold: true, color: { argb: 'FF0000' } };
//     noteRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF99' } };

//     // Re-style the header row (now row 2)
//     const newHeaderRow = worksheet.getRow(2);
//     newHeaderRow.font = { bold: true, color: { argb: 'FFFFFF' } };
//     newHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '2C3E50' } };
//     newHeaderRow.alignment = { horizontal: 'center', vertical: 'middle' };

//     // Apply alternating row colors (starting from row 3)
//     worksheet.eachRow((row, rowNumber) => {
//       if (rowNumber > 2) { // Skip note and header rows
//         if (rowNumber % 2 === 1) { // Odd rows (excluding header)
//           row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8F9FA' } };
//         }
//       }
//     });

//     // Auto-fit columns
//     worksheet.columns.forEach(column => {
//       column.width = Math.max(column.width, 10);
//     });

//     // Generate Excel buffer
//     const excelBuffer = await workbook.xlsx.writeBuffer();

//     // Prepare reports data for email template
//     const reportsWithMedia = resolvedReports.map(report => {
//       const resolvedEntry = report.statusHistory?.find(entry => entry.newStatus === "Resolved");
//       const resolvedAt = resolvedEntry ? resolvedEntry.updatedAt : report.updatedAt;
      
//       return {
//         caseId: report.caseId || `${report.type.substring(0, 3).toUpperCase()}-${report._id.toString().slice(-7)}`,
//         type: report.type,
//         personName: `${report.personInvolved.firstName} ${report.personInvolved.lastName}`,
//         age: report.personInvolved.age,
//         gender: report.personInvolved.gender,
//         lastSeenDate: report.personInvolved.lastSeenDate ? new Date(report.personInvolved.lastSeenDate).toLocaleDateString() : '',
//         lastSeenTime: report.personInvolved.lastSeentime || '',
//         location: `${report.location.address.streetAddress}, ${report.location.address.barangay}, ${report.location.address.city}`,
//         reporterName: `${report.reporter.firstName} ${report.reporter.lastName}`,
//         reporterEmail: report.reporter.email,
//         reporterPhone: report.reporter.number,
//         assignedStation: report.assignedPoliceStation?.name || 'Not assigned',
//         assignedOfficer: report.assignedOfficer ? `${report.assignedOfficer.firstName} ${report.assignedOfficer.lastName}` : 'Not assigned',
//         createdAt: new Date(report.createdAt).toLocaleDateString(),
//         resolvedAt: new Date(resolvedAt).toLocaleDateString(),
//         mainPhoto: report.personInvolved.mostRecentPhoto?.url || null,
//         additionalImages: report.additionalImages || [],
//         video: report.video?.url || null,
//         hasMedia: !!(report.personInvolved.mostRecentPhoto?.url || report.additionalImages?.length > 0 || report.video?.url)
//       };
//     });

//     // Email context
//     const emailContext = {
//       totalReports: resolvedReports.length,
//       dateRange: startDate && endDate ? `${new Date(startDate).toLocaleDateString()} to ${new Date(endDate).toLocaleDateString()}` : 'All time',
//       generatedBy: `${req.user.firstName} ${req.user.lastName}`,
//       generatedDate: new Date().toLocaleDateString(),
//       includesImages: includeImages,
//       totalMediaFiles: totalMediaFiles,
//       reports: reportsWithMedia
//     };

//     // Email attachments (only Excel file)
//     const emailAttachments = [{
//       filename: `Resolved_Reports_Archive_${new Date().toISOString().split('T')[0]}.xlsx`,
//       content: excelBuffer,
//       contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
//     }];

//     // Send email
//     const emailResult = await sendArchiveEmailWithImages(
//       emailContext,
//       [recipientEmail],
//       emailAttachments
//     );

//     if (!emailResult.success) {
//       return res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
//         success: false,
//         msg: "Failed to send archive email",
//         error: emailResult.error
//       });
//     }

//     // After successful email, update reports status to Archived
//     await Report.updateMany(
//       { _id: { $in: resolvedReports.map(r => r._id) } },
//       { 
//         status: "Archived",
//         archivedAt: new Date(),
//         archivedBy: req.user._id
//       }
//     );

//     res.status(statusCodes.OK).json({
//       success: true,
//       msg: `Successfully archived ${resolvedReports.length} resolved reports`,
//       data: {
//         reportsArchived: resolvedReports.length,
//         emailSent: emailResult.success,
//         recipientEmail,
//         dateRange: emailContext.dateRange,
//         includesImages: includeImages,
//         totalMediaFiles: totalMediaFiles,
//         mediaIncludedInEmail: true
//       }
//     });

//   } catch (error) {
//     console.error("Error archiving resolved reports:", error);
//     res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
//       success: false,
//       msg: "Error archiving resolved reports",
//       error: error.message,
//     });
//   }
// });


