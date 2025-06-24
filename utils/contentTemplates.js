// Broadcast notification templates

const broadcastTemplates = {
  report: (report) => ({
    title: `${report.type} Alert`,
    message: `URGENT: Please help us locate\n\nName: ${report.personInvolved.firstName} ${report.personInvolved.lastName}\nAge: ${report.personInvolved.age}\nLast Seen: ${new Date(report.personInvolved.lastSeenDate).toLocaleDateString()} at ${report.personInvolved.lastSeentime}`,
    image: report.personInvolved.mostRecentPhoto.url,
    data: {
      reportId: report._id,
      type: report.type
    }
  }),

  messenger: (report) => ({
    title: `${report.type} Alert`,
    message: `🚨 URGENT ALERT 🚨\n\nName: ${report.personInvolved.firstName} ${report.personInvolved.lastName}\nAge: ${report.personInvolved.age}\nLast Seen: ${new Date(report.personInvolved.lastSeenDate).toLocaleDateString()} at ${report.personInvolved.lastSeentime}`
  }),

  facebook: (report) => ({
    message: `🚨 AGAPAYALERT 🚨
  
  PLEASE HELP US LOCATE:
  Name: ${report.personInvolved.firstName} ${report.personInvolved.lastName}
  Age: ${report.personInvolved.age}
  Last Seen: ${new Date(report.personInvolved.lastSeenDate).toLocaleDateString()} at ${report.personInvolved.lastSeentime}
  Location: ${report.location.address.streetAddress}, ${report.location.address.barangay}, ${report.location.address.city}
  
  If you have any information, please contact the nearest police station.
  
  #MissingPerson #PleaseShare #AgapayAlert`,
    image: report.personInvolved.mostRecentPhoto.url
  }),

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
