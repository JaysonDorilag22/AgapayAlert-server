const isLastSeenMoreThan24Hours = (lastSeenDate, lastSeenTime) => {
    const lastSeen = new Date(`${lastSeenDate} ${lastSeenTime}`);
    const now = new Date();
    const diffInHours = (now - lastSeen) / (1000 * 60 * 60);
    
    return {
      isMoreThan24Hours: diffInHours >= 24,
      hoursPassed: Math.floor(diffInHours)
    };
  };
  
  module.exports = { isLastSeenMoreThan24Hours };