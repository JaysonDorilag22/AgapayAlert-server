const isLastSeenMoreThan24Hours = (lastSeenDate, lastSeenTime) => {
  try {
    // Parse the date
    const lastSeenDateObj = new Date(lastSeenDate);
    
    // Parse the time (convert 12-hour format to 24-hour)
    const timeComponents = lastSeenTime.match(/(\d+):(\d+)\s?(AM|PM)/i);
    if (!timeComponents) {
      throw new Error('Invalid time format');
    }

    let [_, hours, minutes, period] = timeComponents;
    hours = parseInt(hours);
    minutes = parseInt(minutes);

    // Convert to 24-hour format
    if (period.toUpperCase() === 'PM' && hours < 12) {
      hours += 12;
    } else if (period.toUpperCase() === 'AM' && hours === 12) {
      hours = 0;
    }

    // Set the time components
    lastSeenDateObj.setHours(hours, minutes, 0, 0);
    const now = new Date();

    // Calculate hours difference
    const hoursPassed = Math.abs(now - lastSeenDateObj) / (1000 * 60 * 60);
    
    console.log('Time calculation:', {
      lastSeenDate,
      lastSeenTime,
      lastSeenDateTime: lastSeenDateObj,
      now,
      hoursPassed
    });

    return {
      isMoreThan24Hours: hoursPassed > 24,
      hoursPassed: Math.round(hoursPassed)
    };
  } catch (error) {
    console.error('Error calculating time difference:', error);
    return {
      isMoreThan24Hours: false,
      hoursPassed: 0,
      error: error.message
    };
  }
};

module.exports = { isLastSeenMoreThan24Hours };