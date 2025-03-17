const isLastSeenMoreThan24Hours = (dateStr, timeStr) => {
  try {
    // Debug info
    console.log("Date and time inputs:", { dateStr, timeStr });
    
    // Validate inputs
    if (!dateStr || !timeStr) {
      console.warn("Missing date or time input:", { dateStr, timeStr });
      return { isMoreThan24Hours: false, hoursPassed: 0 };
    }

    // Parse the date string
    let lastSeenDate;
    try {
      lastSeenDate = new Date(dateStr);
      if (isNaN(lastSeenDate.getTime())) {
        throw new Error("Invalid date");
      }
    } catch (dateError) {
      console.warn("Invalid date format:", dateStr, dateError);
      return { isMoreThan24Hours: false, hoursPassed: 0 };
    }

    // Parse the time string (accepting various formats)
    let hours = 0, minutes = 0, seconds = 0;
    
    // Try HH:MM:SS format first
    const timeRegex = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/;
    const timeMatch = timeStr.match(timeRegex);
    
    if (timeMatch) {
      hours = parseInt(timeMatch[1], 10);
      minutes = parseInt(timeMatch[2], 10);
      seconds = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
      
      // Validate hour, minute, second ranges
      if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
        console.warn("Time components out of range:", { hours, minutes, seconds });
        return { isMoreThan24Hours: false, hoursPassed: 0 };
      }
    } else {
      console.warn("Could not parse time format:", timeStr);
      return { isMoreThan24Hours: false, hoursPassed: 0 };
    }
    
    // Set the time components on the date
    lastSeenDate.setHours(hours, minutes, seconds);

    // Calculate hours passed
    const now = new Date();
    const hoursPassed = (now - lastSeenDate) / (1000 * 60 * 60);
    
    console.log(`Time check result: ${hoursPassed.toFixed(2)} hours passed since ${lastSeenDate.toISOString()}`);

    return {
      isMoreThan24Hours: hoursPassed >= 24,
      hoursPassed: Math.floor(hoursPassed)
    };
  } catch (error) {
    console.error("Error calculating time difference:", error);
    // Return a safe default instead of throwing
    return { isMoreThan24Hours: false, hoursPassed: 0 };
  }
};

module.exports = { isLastSeenMoreThan24Hours };