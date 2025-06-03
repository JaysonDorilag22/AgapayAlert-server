const FinderReport = require("../models/FinderReportModel");
const Report = require("../models/reportModel");
const Notification = require("../models/notificationModel");
const asyncHandler = require("express-async-handler");
const statusCodes = require("../constants/statusCodes");
const { getCoordinatesFromAddress } = require("../utils/geocoding");
const uploadToCloudinary = require("../utils/uploadToCloudinary");
const { sendEmailNotification, notifyFinderReport, sendOneSignalNotification } = require("../utils/notificationUtils");
const { getIO, SOCKET_EVENTS } = require("../utils/socketUtils");
const cloudinary = require("cloudinary").v2;
// Create finder report with images and notify police station
exports.createFinderReport = asyncHandler(async (req, res) => {
  try {
    const { originalReportId, discoveryDetails, personCondition, authoritiesNotified } = req.body;

    // Validate original report with populated fields
    const originalReport = await Report.findById(originalReportId)
      .populate("assignedPoliceStation")
      .populate("assignedOfficer", "firstName lastName deviceToken")
      .populate("personInvolved");

    if (!originalReport) {
      return res.status(statusCodes.NOT_FOUND).json({ msg: "Original report not found" });
    }

    // Get coordinates and create finder report
    const geoData = await getCoordinatesFromAddress(discoveryDetails.address);
    if (!geoData.success) {
      return res.status(statusCodes.BAD_REQUEST).json({ msg: geoData.message });
    }

    let images = [];
    if (req.files?.images) {
      const uploadPromises = req.files.images.map((file) => uploadToCloudinary(file.path, "finder_reports"));
      const uploadResults = await Promise.all(uploadPromises);
      images = uploadResults.map((result) => ({
        url: result.url,
        public_id: result.public_id,
      }));
    }

    const finderReport = new FinderReport({
      originalReport: originalReportId,
      finder: req.user.id,
      discoveryDetails: {
        ...discoveryDetails,
        location: {
          type: "Point",
          coordinates: geoData.coordinates,
          address: discoveryDetails.address,
        },
      },
      personCondition,
      authoritiesNotified: authoritiesNotified || false,
      images,
      status: "Pending",
    });

    await finderReport.save();

    const notificationMessage = `New finder report submitted for case: ${originalReport.type} - ${originalReport.personInvolved.firstName} ${originalReport.personInvolved.lastName}`;

    // Prepare notifications
    try {
      const notificationPromises = [];

      // 1. Notify assigned officer if exists
      if (originalReport.assignedOfficer?.deviceToken) {
        // In-app notification for officer
        notificationPromises.push(
          Notification.create({
            recipient: originalReport.assignedOfficer._id,
            type: "FINDER_REPORT",
            title: "New Finder Report",
            message: `New finder report for your assigned case: ${originalReport.type}`,
            data: {
              finderReportId: finderReport._id,
              originalReportId: originalReport._id,
              type: "FINDER_REPORT",
              personCondition,
              discoveryLocation: `${discoveryDetails.address.streetAddress}, ${discoveryDetails.address.barangay}`,
            },
          })
        );

        // Push notification for officer
        notificationPromises.push(
          sendOneSignalNotification({
            include_player_ids: [originalReport.assignedOfficer.deviceToken],
            headings: { en: "New Finder Report" },
            contents: {
              en: `New finder report submitted for your assigned case: ${originalReport.type}`,
            },
            data: {
              type: "FINDER_REPORT",
              finderReportId: finderReport._id,
              originalReportId: originalReport._id,
              personCondition,
              discoveryLocation: `${discoveryDetails.address.streetAddress}, ${discoveryDetails.address.barangay}`,
            },
          })
        );
      }

      // 2. Notify finder (report creator)
      notificationPromises.push(
        Notification.create({
          recipient: req.user.id,
          type: "FINDER_REPORT_CREATED",
          title: "Finder Report Submitted",
          message: `Your finder report has been submitted successfully`,
          data: {
            finderReportId: finderReport._id,
            originalReportId: originalReport._id,
            type: "FINDER_REPORT_CREATED",
            discoveryLocation: `${discoveryDetails.address.streetAddress}, ${discoveryDetails.address.barangay}`,
            reportType: originalReport.type,
            personName: `${originalReport.personInvolved.firstName} ${originalReport.personInvolved.lastName}`,
          },
        })
      );

      // Push notification for finder if they have device token
      if (req.user.deviceToken) {
        notificationPromises.push(
          sendOneSignalNotification({
            include_player_ids: [req.user.deviceToken],
            headings: { en: "Finder Report Submitted" },
            contents: {
              en: `Your finder report has been submitted and is pending verification`,
            },
            data: {
              type: "FINDER_REPORT_CREATED",
              finderReportId: finderReport._id,
              originalReportId: originalReport._id,
              discoveryLocation: `${discoveryDetails.address.streetAddress}, ${discoveryDetails.address.barangay}`,
            },
          })
        );
      }

      // Send all notifications
      await Promise.allSettled(notificationPromises);

      // Socket notifications
      const io = getIO();

      // Emit to assigned officer if exists
      if (originalReport.assignedOfficer) {
        io.to(`user_${originalReport.assignedOfficer._id}`).emit("FINDER_REPORT", {
          finderReport,
          originalReport,
          message: notificationMessage,
        });
      }

      // Emit to finder
      io.to(`user_${req.user.id}`).emit("FINDER_REPORT_CREATED", {
        finderReport,
        originalReport,
        message: "Your finder report has been submitted successfully",
      });
    } catch (notificationError) {
      console.error("Notification failed but finder report was saved:", notificationError);
    }

    res.status(statusCodes.CREATED).json({
      success: true,
      msg: "Finder report created successfully",
      finderReport,
    });
  } catch (error) {
    console.error("Error creating finder report:", error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      msg: "Error creating finder report",
      error: error.message,
    });
  }
});

// Get all finder reports with filters and pagination
exports.getFinderReports = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, startDate, endDate } = req.query;
  const query = {};

  if (status) query.status = status;
  if (startDate && endDate) {
    query.createdAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    };
  }

  const reports = await FinderReport.find(query)
    .populate("finder", "-password")
    .populate("originalReport")
    .populate("verifiedBy", "-password")
    .sort("-createdAt")
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await FinderReport.countDocuments(query);

  res.status(statusCodes.OK).json({
    reports,
    totalPages: Math.ceil(total / limit),
    currentPage: page,
    total,
  });
});

// Update finder report
exports.updateFinderReport = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { discoveryDetails, personCondition, authoritiesNotified } = req.body;

  const report = await FinderReport.findById(id)
    .populate("finder", "firstName lastName deviceToken")
    .populate({
      path: "originalReport",
      populate: [
        {
          path: "personInvolved",
        },
        {
          path: "assignedOfficer",
          select: "firstName lastName deviceToken",
        },
      ],
    });

  if (!report) {
    return res.status(statusCodes.NOT_FOUND).json({ msg: "Finder report not found" });
  }

  // Only allow updates if status is pending
  if (report.status !== "Pending") {
    return res.status(statusCodes.BAD_REQUEST).json({
      msg: "Cannot update verified or false reports",
    });
  }

  // Handle new images
  if (req.files?.images) {
    const uploadPromises = req.files.images.map((file) => uploadToCloudinary(file.path, "finder_reports"));
    const uploadResults = await Promise.all(uploadPromises);
    const newImages = uploadResults.map((result) => ({
      url: result.url,
      public_id: result.public_id,
    }));
    report.images = [...report.images, ...newImages].slice(0, 5); 
  }

  Object.assign(report, {
    discoveryDetails,
    personCondition,
    authoritiesNotified,
  });

  await report.save();

  // Send notifications after successful update
  try {
    const notificationPromises = [];
    const updateMessage = "Finder report has been updated with new information";
    const personName = report.originalReport.personInvolved ? 
      `${report.originalReport.personInvolved.firstName} ${report.originalReport.personInvolved.lastName}` : 
      "Missing person";

    // 1. Notify the finder (report creator)
    if (report.finder?.deviceToken) {
      notificationPromises.push(
        sendOneSignalNotification({
          include_player_ids: [report.finder.deviceToken],
          headings: { en: "Finder Report Updated" },
          contents: {
            en: "Your finder report has been updated successfully. Please keep checking for status updates.",
          },
          data: {
            type: "FINDER_REPORT_UPDATED",
            finderReportId: report._id,
            originalReportId: report.originalReport._id,
          },
        })
      );
    }

    // 2. Notify assigned officer if exists
    if (report.originalReport.assignedOfficer?.deviceToken) {
      notificationPromises.push(
        sendOneSignalNotification({
          include_player_ids: [report.originalReport.assignedOfficer.deviceToken],
          headings: { en: "Finder Report Updated" },
          contents: {
            en: `A finder report for ${personName} has been updated with new information. Please review the changes.`,
          },
          data: {
            type: "FINDER_REPORT_UPDATED",
            finderReportId: report._id,
            originalReportId: report.originalReport._id,
          },
        })
      );
    }

    // Send all notifications
    await Promise.allSettled(notificationPromises);

    // Socket notifications
    const io = getIO();

    // Emit to finder
    if (report.finder) {
      io.to(`user_${report.finder._id}`).emit("FINDER_REPORT_UPDATED", {
        finderReport: report,
        message: "Your finder report has been updated successfully",
      });
    }

    // Emit to assigned officer
    if (report.originalReport.assignedOfficer) {
      io.to(`user_${report.originalReport.assignedOfficer._id}`).emit("FINDER_REPORT_UPDATED", {
        finderReport: report,
        message: updateMessage,
      });
    }
  } catch (notificationError) {
    console.error("Failed to send notifications for finder report update:", notificationError);
    // We don't want to fail the update if notifications fail
  }

  res.status(statusCodes.OK).json({
    success: true,
    msg: "Finder report updated successfully",
    report,
  });
});

// Get single finder report
exports.getFinderReportById = asyncHandler(async (req, res) => {
  const report = await FinderReport.findById(req.params.id)
    .populate("finder", "-password")
    .populate("originalReport")
    .populate("verifiedBy", "-password");

  if (!report) {
    return res.status(statusCodes.NOT_FOUND).json({
      msg: "Finder report not found",
    });
  }

  res.status(statusCodes.OK).json(report);
});

// Verify finder report and notify the finder
exports.verifyFinderReport = asyncHandler(async (req, res) => {
  const { status, verificationNotes } = req.body;

  const report = await FinderReport.findById(req.params.id)
    .populate("finder", "firstName lastName email deviceToken")
    .populate({
      path: "originalReport",
      populate: [
        {
          path: "personInvolved",
        },
        {
          path: "assignedOfficer",
          select: "firstName lastName deviceToken",
        },
      ],
    });

  if (!report) {
    return res.status(statusCodes.NOT_FOUND).json({
      msg: "Finder report not found",
    });
  }

  report.status = status;
  report.verifiedBy = req.user.id;
  report.verificationNotes = verificationNotes;
  await report.save();

  // Prepare notifications
  try {
    const notificationPromises = [];

    // 1. Email notification to finder
    const emailContext = {
      finderReportId: report._id,
      reportType: report.originalReport.type,
      personName: `${report.originalReport.personInvolved.firstName} ${report.originalReport.personInvolved.lastName}`,
      status: status,
      notes: verificationNotes,
      discoveryLocation: `${report.discoveryDetails.location.address.streetAddress}, ${report.discoveryDetails.location.address.barangay}`,
    };

    notificationPromises.push(
      sendEmailNotification("finderReportVerification.ejs", emailContext, [report.finder.email])
    );

    // 2. In-app notification for finder
    notificationPromises.push(
      Notification.create({
        recipient: report.finder._id,
        type: "FINDER_REPORT_VERIFIED",
        title: "Finder Report Verification",
        message: `Your finder report has been ${status.toLowerCase()}`,
        data: {
          finderReportId: report._id,
          originalReportId: report.originalReport._id,
          status,
          verificationNotes,
        },
      })
    );

    // 3. Push notification for finder if they have a device token
    if (report.finder.deviceToken) {
      notificationPromises.push(
        sendOneSignalNotification({
          include_player_ids: [report.finder.deviceToken],
          headings: { en: "Finder Report Update" },
          contents: {
            en: `Your finder report has been ${status.toLowerCase()}`,
          },
          data: {
            type: "FINDER_REPORT_VERIFIED",
            finderReportId: report._id,
            originalReportId: report.originalReport._id,
            status,
            verificationNotes,
          },
        })
      );
    }

    // 4. Notify assigned officer if exists
    if (report.originalReport.assignedOfficer?.deviceToken) {
      notificationPromises.push(
        Notification.create({
          recipient: report.originalReport.assignedOfficer._id,
          type: "FINDER_REPORT_VERIFIED",
          title: "Finder Report Verification",
          message: `A finder report for your case has been ${status.toLowerCase()}`,
          data: {
            finderReportId: report._id,
            originalReportId: report.originalReport._id,
            status,
            verificationNotes,
          },
        })
      );

      // Push notification for assigned officer
      notificationPromises.push(
        sendOneSignalNotification({
          include_player_ids: [report.originalReport.assignedOfficer.deviceToken],
          headings: { en: "Finder Report Update" },
          contents: {
            en: `A finder report for your case has been ${status.toLowerCase()}`,
          },
          data: {
            type: "FINDER_REPORT_VERIFIED",
            finderReportId: report._id,
            originalReportId: report.originalReport._id,
            status,
            verificationNotes,
          },
        })
      );
    }

    // Send all notifications
    await Promise.allSettled(notificationPromises);

    // Socket notifications
    const io = getIO();

    // Emit to finder
    io.to(`user_${report.finder._id}`).emit("FINDER_REPORT_VERIFIED", {
      finderReport: report,
      message: `Your finder report has been ${status.toLowerCase()}`,
    });

    // Emit to assigned officer
    if (report.originalReport.assignedOfficer) {
      io.to(`user_${report.originalReport.assignedOfficer._id}`).emit("FINDER_REPORT_VERIFIED", {
        finderReport: report,
        message: `A finder report for your case has been ${status.toLowerCase()}`,
      });
    }

    console.log("All notifications sent successfully");
  } catch (notificationError) {
    console.error("Failed to send notifications:", notificationError);
  }

  res.status(statusCodes.OK).json({
    msg: "Finder report verified successfully",
    report,
  });
});

exports.getFinderReportsByReportId = asyncHandler(async (req, res) => {
  const { reportId } = req.params;

  const originalReport = await Report.findById(reportId);
  if (!originalReport) {
    return res.status(statusCodes.NOT_FOUND).json({
      msg: "Original report not found",
    });
  }

  const finderReports = await FinderReport.find({ originalReport: reportId })
    .populate("finder", "-password")
    .populate("verifiedBy", "-password")
    .sort("-createdAt");

  res.status(statusCodes.OK).json({
    count: finderReports.length,
    finderReports,
  });
});

// Delete finder report
exports.deleteFinderReport = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const report = await FinderReport.findById(id);

  if (!report) {
    return res.status(statusCodes.NOT_FOUND).json({
      success: false,
      msg: "Finder report not found",
    });
  }

  // Delete associated images from Cloudinary
  if (report.images?.length > 0) {
    const deletePromises = report.images.map((image) => cloudinary.uploader.destroy(image.public_id));
    await Promise.all(deletePromises);
  }

  await report.deleteOne();

  res.status(statusCodes.OK).json({
    success: true,
    msg: "Finder report deleted successfully",
  });
});

module.exports = exports;
