module.exports = {
  USER: {
    role: 'user',
    description: 'Regular citizens using the app to report incidents such as missing persons, kidnappings, hit-and-runs, or abductions.',
    responsibilities: [
      'Can create and submit reports for incidents (missing persons, hit-and-run, kidnappings, etc.).',
      'Can upload images for the reports.',
      'Can choose or have the app automatically assign the nearest police station for their report.',
      'Can track the status of their submitted report.',
      'Cannot view detailed reports submitted by others.',
      'Cannot update or resolve reports.',
      'Cannot access any sensitive data or control any police-related actions.',
    ],
  },
  POLICE_OFFICER: {
    role: 'police_officer',
    description: 'Officers assigned to manage and investigate cases reported through the app. They are the primary responders to reports.',
    responsibilities: [
      'Can view all incoming reports assigned to their police station.',
      'Can update the status of reports (e.g., mark a report as "In Progress", "Resolved").',
      'Can add comments and updates to the report for internal communication.',
      'Can see details about the incident (e.g., images, description, location).',
      'Can request additional resources (like K9 units or backup).',
      'Cannot create or edit reports submitted by citizens.',
      'Cannot delete or close reports without resolving them.',
      'Can only access reports assigned to their police station.',
    ],
  },
  POLICE_ADMIN: {
    role: 'police_admin',
    description: 'Admins who have higher access within the police station. They can manage officers and oversee the general flow of reports.',
    responsibilities: [
      'Can manage officer accounts within their station, including adding or removing officers.',
      'Can assign incoming reports to specific officers.',
      'Can update the status of reports (same as police officers).',
      'Can review all the reports under their police station.',
      'Cannot delete reports or modify the data unless necessary.',
      'Can escalate cases to higher authorities or other stations if needed.',
      'Cannot access reports beyond their station’s jurisdiction.',
    ],
  },
  CITY_ADMIN: {
    role: 'city_admin',
    description: 'Admins responsible for managing the police stations within a specific city. They supervise the operations of multiple police stations in the city.',
    responsibilities: [
      'Can manage multiple police stations under their city jurisdiction.',
      'Can view and monitor reports across all police stations within the city.',
      'Can assign or reassign officers between police stations.',
      'Can escalate or assign cases to other stations if the incident spans across jurisdictions.',
      'Cannot resolve or close any cases. That is the responsibility of the officer or station admin.',
      'Cannot modify sensitive information (like citizen details) unless authorized.',
    ],
  },
  SUPER_ADMIN: {
    role: 'super_admin',
    description: 'The highest role, overseeing the entire system. They have complete control over all the users, police stations, and other administrative tasks.',
    responsibilities: [
      'Can manage all user accounts, including users, officers, and admins.',
      'Can manage all police stations, cities, and jurisdictions.',
      'Can review, monitor, and update all reports from any station or city.',
      'Can escalate or reassign cases across cities, stations, or even higher authorities.',
      'Can update roles or permissions for any user in the system.',
      'Can access all the reports, whether marked as resolved or in progress.',
      'Can perform maintenance tasks such as database clean-up or resetting certain parameters.',
      'Cannot directly interact with a report as a police officer but can view and supervise all reports.',
    ],
  },
};