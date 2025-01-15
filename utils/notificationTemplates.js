const broadcastTypes = {
    MISSING_PERSON: {
      type: 'MISSING_PERSON_ALERT',
      title: 'Missing Person Alert',
      template: (name, location) => `Missing person reported: ${name} last seen at ${location}`
    },
    FOUND_PERSON: {
      type: 'FOUND_PERSON_ALERT',
      title: 'Found Person Alert',
      template: (details) => `Person found matching description: ${details}`
    },
    EMERGENCY: {
      type: 'EMERGENCY_ALERT',
      title: 'Emergency Alert',
      template: (type, location) => `${type} emergency reported at ${location}`
    }
  };
  
  module.exports = { broadcastTypes };