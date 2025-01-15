
// Broadcast notification templates
const broadcastTemplates = {
  report: (report) => ({
    title: `${report.type} Alert`,
    message: `URGENT: Please help us locate
      
  Name: ${report.personInvolved.firstName} ${report.personInvolved.lastName}
  Age: ${report.personInvolved.age}
  Last Seen: ${new Date(
    report.personInvolved.lastSeenDate
  ).toLocaleDateString()} at ${report.personInvolved.lastSeentime}
  Last Known Location: ${report.personInvolved.lastKnownLocation}
  Address: ${report.location.address.streetAddress}, ${
      report.location.address.barangay
    }, ${report.location.address.city}`,
    image: report.personInvolved.mostRecentPhoto.url,
  }),

  facebook: (report) => {
    if (!report?.personInvolved) {
      throw new Error('Invalid report data for Facebook template');
    }

    return {
      message: `🚨 MISSING PERSON ALERT 🚨

PLEASE HELP US LOCATE:
Name: ${report.personInvolved.firstName} ${report.personInvolved.lastName}
Age: ${report.personInvolved.age}
Last Seen: ${new Date(report.personInvolved.lastSeenDate).toLocaleDateString()} at ${report.personInvolved.lastSeentime}
Last Known Location: ${report.location.address.streetAddress}, ${report.location.address.barangay}, ${report.location.address.city}

If you have any information, please contact:
- Nearest Police Station
- AgapayAlert Emergency Hotline

#MissingPerson #PleaseShare #AgapayAlert`,
      image: report.personInvolved.mostRecentPhoto.url
    };
  },

  sms: (report) => ({
    message: `AgapayAlert: ${report.type} - ${report.personInvolved.firstName} ${report.personInvolved.lastName}, ${report.personInvolved.age}yo, last seen at ${report.personInvolved.lastKnownLocation}`,
  }),
};

// Police notification templates
const policeTemplates = {
  newReport: (report) => ({
    title: "New Report Alert",
    message: `URGENT: New ${report.type} Report - ${report.personInvolved.firstName} ${report.personInvolved.lastName}`,
    data: {
      reportId: report._id,
      type: "NEW_REPORT",
      reportType: report.type,
    },
  }),

  finderReport: (finderReport, originalReport) => ({
    title: "New Finder Report",
    message: `New finder report submitted for case: ${originalReport.type} - ${originalReport.personInvolved.firstName} ${originalReport.personInvolved.lastName}`,
    location: `${finderReport.discoveryDetails.location.address.streetAddress}, ${finderReport.discoveryDetails.location.address.barangay}, ${finderReport.discoveryDetails.location.address.city}`,
  }),
};

// User notification templates
const userTemplates = {
  reportCreated: (type, stationName) => ({
    title: "Report Created",
    message: `Your ${type} report has been created and assigned to ${stationName}`,
  }),

  statusUpdate: (status) => ({
    title: "Report Status Updated",
    message: `Your report status has been updated to ${status}`,
  }),

  finderVerification: (status, notes) => ({
    title: "Finder Report Verified",
    message: `Your finder report has been ${status}${
      notes ? `: ${notes}` : ""
    }`,
  }),
};

module.exports = {
  broadcastTemplates,
  policeTemplates,
  userTemplates,
};
