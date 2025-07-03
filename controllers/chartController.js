const Report = require('../models/reportModel');
const User = require('../models/userModel');
const PoliceStation = require('../models/policeStationModel');
const asyncHandler = require('express-async-handler');
const statusCodes = require('../constants/statusCodes');

// Insomnia Sample Requests for Demographics Analysis API/
// Base URL
// Filter Combinations
// 1. No filters (get all data)
// http://localhost:3000/api/v1/charts/demographics
// 2. Filter by age category
// http://localhost:3000/api/v1/charts/demographics?ageCategory=adult
// 3. Filter by location
// http://localhost:3000/api/v1/charts/demographics?city=SampleCity
// 4. Filter by police station
// http://localhost:3000/api/v1/charts/demographics?policeStationId=12345
// 5. Filter by date range
// http://localhost:3000/api/v1/charts/demographics?startDate=2023-01-01&endDate=2023-12-31
// 6. Filter by report type
// http://localhost:3000/api/v1/charts/demographics?reportType=Missing
// 7. Filter by gender
// http://localhost:3000/api/v1/charts/demographics?gender=male
// 8. Combined filters
// http://localhost:3000/api/v1/charts/demographics?ageCategory=adult&city=SampleCity&policeStationId=12345&startDate=2023-01-01&endDate=2023-12-31&reportType=missing


// User Demographics Analysis with age categories
exports.getUserDemographicsAnalysis = asyncHandler(async (req, res) => {
  try {
    const {
      ageCategory,
      city,
      barangay,
      policeStationId,
      startDate,
      endDate,
      reportType,
      gender,
      prevStartDate,
      prevEndDate
    } = req.query;

    // Get base query from role
    let query = await getRoleBasedQuery(req.user);

    // Add filters to query
    if (city) query['location.address.city'] = city;
    if (barangay) query['location.address.barangay'] = barangay;
    if (policeStationId) query.assignedPoliceStation = policeStationId;
    if (reportType) query.type = reportType;
    if (ageCategory) {
      const ageRanges = {
        'infant': { min: 0, max: 2 },
        'child': { min: 3, max: 12 },
        'teen': { min: 13, max: 19 },
        'young_adult': { min: 20, max: 35 },
        'adult': { min: 36, max: 59 },
        'senior': { min: 60, max: 150 }
      };
      if (ageRanges[ageCategory]) {
        query['personInvolved.age'] = { 
          $gte: ageRanges[ageCategory].min, 
          $lte: ageRanges[ageCategory].max 
        };
      }
    }
    if (gender) query['personInvolved.gender'] = gender;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    // For trend/percentage change, get previous period data if requested
    let prevQuery = null, prevTotal = null;
    if (prevStartDate || prevEndDate) {
      prevQuery = { ...query };
      prevQuery.createdAt = {};
      if (prevStartDate) prevQuery.createdAt.$gte = new Date(prevStartDate);
      if (prevEndDate) prevQuery.createdAt.$lte = new Date(prevEndDate);
      prevTotal = await Report.countDocuments(prevQuery);
    }

    // Get reports with needed fields
    const reports = await Report.find(query)
      .populate('reporter', 'age address gender')
      .populate('assignedPoliceStation', 'name address')
      .select('personInvolved location type status createdAt updatedAt reporter assignedPoliceStation')
      .lean();

    const total = reports.length;

    // Helper: count and percent
    const countAndPercent = (obj, total) => {
      return Object.entries(obj).map(([key, count]) => ({
        label: key,
        count,
        percent: total ? ((count / total) * 100).toFixed(1) : "0.0"
      }));
    };

    // Process reports into statistical categories
    const stats = {
      total,
      byAgeCategory: {},
      byCity: {},
      byBarangay: {},
      byGender: {},
      byPoliceStation: {},
      byReportType: {},
      byStatus: {}
    };

    // For cross-category and alarming/good numbers
    const crossCategory = {
      ageByBarangay: {},
      typeByBarangay: {},
      unresolvedByCity: {},
      childrenByBarangay: {},
      repeatReporters: {},
      repeatAreas: {},
      longPendingCases: [],
      monthlyTrends: {},
      resolutionTimes: []
    };

    // Helper for monthly trend
    const getMonthKey = (date) => {
      const d = new Date(date);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };

    // Helper for resolution time
    const getResolutionTime = (report) => {
      if (report.status === 'Resolved' && report.createdAt && report.updatedAt) {
        return (new Date(report.updatedAt) - new Date(report.createdAt)) / 3600000; // hours
      }
      return null;
    };

    // Process each report to build statistics
    reports.forEach(report => {
      // Age category grouping
      const age = report.personInvolved.age || 0;
      let ageCat;
      if (age <= 2) ageCat = 'Infant (0-2)';
      else if (age <= 12) ageCat = 'Child (3-12)';
      else if (age <= 19) ageCat = 'Teen (13-19)';
      else if (age <= 35) ageCat = 'Young Adult (20-35)';
      else if (age <= 59) ageCat = 'Adult (36-59)';
      else ageCat = 'Senior (60+)';
      stats.byAgeCategory[ageCat] = (stats.byAgeCategory[ageCat] || 0) + 1;

      // City grouping
      const city = report.location.address.city;
      if (city) stats.byCity[city] = (stats.byCity[city] || 0) + 1;

      // Barangay grouping
      const barangay = report.location.address.barangay;
      if (barangay) stats.byBarangay[barangay] = (stats.byBarangay[barangay] || 0) + 1;

      // Gender grouping
      const gender = report.personInvolved.gender || 'Unknown';
      stats.byGender[gender] = (stats.byGender[gender] || 0) + 1;

      // Police station grouping
      if (report.assignedPoliceStation) {
        const stationName = report.assignedPoliceStation.name;
        stats.byPoliceStation[stationName] = (stats.byPoliceStation[stationName] || 0) + 1;
      }

      // Report type grouping
      const reportType = report.type;
      stats.byReportType[reportType] = (stats.byReportType[reportType] || 0) + 1;

      // Status grouping
      const status = report.status;
      stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;

      // Cross-category: age by barangay
      if (barangay && ageCat) {
        if (!crossCategory.ageByBarangay[barangay]) crossCategory.ageByBarangay[barangay] = {};
        crossCategory.ageByBarangay[barangay][ageCat] = (crossCategory.ageByBarangay[barangay][ageCat] || 0) + 1;
      }
      // Cross-category: type by barangay
      if (barangay && reportType) {
        if (!crossCategory.typeByBarangay[barangay]) crossCategory.typeByBarangay[barangay] = {};
        crossCategory.typeByBarangay[barangay][reportType] = (crossCategory.typeByBarangay[barangay][reportType] || 0) + 1;
      }
      // Unresolved by city
      if (city && status !== "Resolved") {
        crossCategory.unresolvedByCity[city] = (crossCategory.unresolvedByCity[city] || 0) + 1;
      }
      // Children by barangay
      if (barangay && ageCat === "Child (3-12)") {
        crossCategory.childrenByBarangay[barangay] = (crossCategory.childrenByBarangay[barangay] || 0) + 1;
      }
      // Repeat reporters
      if (report.reporter && report.reporter._id) {
        const reporterId = report.reporter._id.toString();
        crossCategory.repeatReporters[reporterId] = (crossCategory.repeatReporters[reporterId] || 0) + 1;
      }
      // Repeat areas (city+barangay)
      if (city && barangay) {
        const areaKey = `${city}|${barangay}`;
        crossCategory.repeatAreas[areaKey] = (crossCategory.repeatAreas[areaKey] || 0) + 1;
      }
      // Long pending cases
      if (status !== 'Resolved' && report.createdAt) {
        const daysPending = (Date.now() - new Date(report.createdAt)) / (1000 * 60 * 60 * 24);
        if (daysPending > 30) {
          crossCategory.longPendingCases.push({
            id: report._id,
            city,
            barangay,
            daysPending: Math.round(daysPending),
            type: reportType,
            status
          });
        }
      }
      // Monthly trends
      const monthKey = getMonthKey(report.createdAt);
      crossCategory.monthlyTrends[monthKey] = (crossCategory.monthlyTrends[monthKey] || 0) + 1;
      // Resolution times
      const resTime = getResolutionTime(report);
      if (resTime !== null) crossCategory.resolutionTimes.push(resTime);
    });

    // Chart data
    const formatForChart = (obj) => ({
      labels: Object.keys(obj),
      values: Object.values(obj)
    });

    // --- SCATTER PLOT: Age Category vs. Resolution Time ---
    // Map age categories to numeric values for X-axis
    const ageCategoryMap = {
      'Infant (0-2)': 1,
      'Child (3-12)': 2,
      'Teen (13-19)': 3,
      'Young Adult (20-35)': 4,
      'Adult (36-59)': 5,
      'Senior (60+)': 6
    };
    // Collect scatter data points: { x: ageCategoryNum, y: resolutionTime, label: ageCategory }
    const scatterData = [];
    reports.forEach(report => {
      const age = report.personInvolved.age || 0;
      let ageCat;
      if (age <= 2) ageCat = 'Infant (0-2)';
      else if (age <= 12) ageCat = 'Child (3-12)';
      else if (age <= 19) ageCat = 'Teen (13-19)';
      else if (age <= 35) ageCat = 'Young Adult (20-35)';
      else if (age <= 59) ageCat = 'Adult (36-59)';
      else ageCat = 'Senior (60+)';
      const resTime = getResolutionTime(report);
      if (resTime !== null && ageCategoryMap[ageCat]) {
        scatterData.push({
          x: ageCategoryMap[ageCat],
          y: parseFloat(resTime),
          label: ageCat
        });
      }
    });
    // For chart.js, you may want to group by age category and show all points, or average per category
    // Here, we provide all points for a true scatter plot

    // Top locations
    const topN = (obj, n = 3) => Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([label, count]) => ({ label, count }));

    // Differential helpers
    const genderArr = countAndPercent(stats.byGender, total);
    const male = genderArr.find(g => g.label.toLowerCase() === "male") || { count: 0, percent: 0 };
    const female = genderArr.find(g => g.label.toLowerCase() === "female") || { count: 0, percent: 0 };
    const genderDiff = Math.abs(male.count - female.count);
    const genderDiffPercent = total ? ((genderDiff / total) * 100).toFixed(1) : "0.0";
    const genderDiffText = male.count > female.count
      ? `There are ${genderDiffPercent}% more reports involving males than females.`
      : female.count > male.count
        ? `There are ${genderDiffPercent}% more reports involving females than males.`
        : "Reports are evenly split between males and females.";

    // Alarming/Good numbers
    const maxChildBarangay = Object.entries(crossCategory.childrenByBarangay)
      .sort((a, b) => b[1] - a[1])[0];
    const avgChildBarangay = Object.values(crossCategory.childrenByBarangay).reduce((a, b) => a + b, 0) /
      (Object.keys(crossCategory.childrenByBarangay).length || 1);
    const alarmingChildText = maxChildBarangay && maxChildBarangay[1] > avgChildBarangay * 1.5
      ? `High number of reports involving children (3-12) in ${maxChildBarangay[0]}: ${maxChildBarangay[1]}, which is above the average for other barangays (${avgChildBarangay.toFixed(1)}).`
      : null;

    // Most common report type
    const typeArr = countAndPercent(stats.byReportType, total);
    const mostCommonType = typeArr.sort((a, b) => b.count - a.count)[0];

    // Status differential
    const unresolved = (stats.byStatus["Pending"] || 0) + (stats.byStatus["Under Investigation"] || 0);
    const unresolvedPercent = total ? ((unresolved / total) * 100).toFixed(1) : "0.0";

    // Comparative/Trend
    let trendText = "";
    if (prevTotal !== null) {
      const diff = total - prevTotal;
      const percentChange = prevTotal ? ((diff / prevTotal) * 100).toFixed(1) : "0.0";
      trendText = diff > 0
        ? `Reports increased by ${percentChange}% compared to the previous period.`
        : diff < 0
          ? `Reports decreased by ${Math.abs(percentChange)}% compared to the previous period.`
          : "No change in total reports compared to the previous period.";
    }

    // Top city/barangay/police station
    const topCities = topN(stats.byCity);
    const topBarangays = topN(stats.byBarangay);
    const topStations = topN(stats.byPoliceStation);

    // Cross-category: most reports involving children are from which barangay
    const mostChildBarangay = maxChildBarangay ? maxChildBarangay[0] : null;

    // Monthly trend analytics
    const monthlyTrendArr = Object.entries(crossCategory.monthlyTrends)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, count]) => ({ month, count }));
    let trendDirection = '';
    if (monthlyTrendArr.length > 1) {
      const first = monthlyTrendArr[0].count;
      const last = monthlyTrendArr[monthlyTrendArr.length - 1].count;
      if (last > first) trendDirection = 'increasing';
      else if (last < first) trendDirection = 'decreasing';
      else trendDirection = 'stable';
    }
    // Detect spikes
    let spikeText = '';
    if (monthlyTrendArr.length > 2) {
      for (let i = 1; i < monthlyTrendArr.length - 1; i++) {
        if (monthlyTrendArr[i].count > monthlyTrendArr[i - 1].count * 1.5 && monthlyTrendArr[i].count > monthlyTrendArr[i + 1].count * 1.5) {
          spikeText = `Spike detected in ${monthlyTrendArr[i].month} with ${monthlyTrendArr[i].count} reports.`;
          break;
        }
      }
    }

    // Average and fastest resolution time
    const avgResolutionTime = crossCategory.resolutionTimes.length
      ? (crossCategory.resolutionTimes.reduce((a, b) => a + b, 0) / crossCategory.resolutionTimes.length).toFixed(1)
      : null;
    const fastestResolutionTime = crossCategory.resolutionTimes.length
      ? Math.min(...crossCategory.resolutionTimes).toFixed(1)
      : null;

    // Long pending cases (top 3)
    const longPendingCases = crossCategory.longPendingCases
      .sort((a, b) => b.daysPending - a.daysPending)
      .slice(0, 3);

    // Repeat reporters (top 3)
    const repeatReportersArr = Object.entries(crossCategory.repeatReporters)
      .filter(([_, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([reporterId, count]) => ({ reporterId, count }));

    // Repeat areas (top 3)
    const repeatAreasArr = Object.entries(crossCategory.repeatAreas)
      .filter(([_, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([area, count]) => {
        const [city, barangay] = area.split('|');
        return { city, barangay, count };
      });

    // Compose summary paragraph
    const summaryParagraph = `
      In this reporting period, a total of ${total} cases were recorded. 
      The majority of reports involved ${typeArr.length ? typeArr[0].label : "N/A"}, accounting for ${typeArr.length ? typeArr[0].percent : "0"}% of all cases.
      ${genderArr.length ? `Males were involved in ${male.percent}% of reports, while females accounted for ${female.percent}%` : ""}
      ${topCities.length ? `The city with the highest number of reports was ${topCities[0].label}, with Barangay ${topBarangays[0]?.label || "N/A"} being the most affected area.` : ""}
      Notably, ${unresolvedPercent}% of all cases remain unresolved, with ${mostCommonType ? mostCommonType.label : "N/A"} reports being the most common type.
      ${trendText}
      ${alarmingChildText ? alarmingChildText : ""}
      ${spikeText}
      ${trendDirection ? `The overall trend is ${trendDirection}.` : ""}
      ${avgResolutionTime ? `Average resolution time is ${avgResolutionTime} hours.` : ""}
      ${fastestResolutionTime ? `Fastest resolution was ${fastestResolutionTime} hours.` : ""}
      ${longPendingCases.length ? `There are ${longPendingCases.length} long-pending cases (over 30 days).` : ""}
      ${repeatReportersArr.length ? `There are repeat reporters, with the top reporter submitting ${repeatReportersArr[0].count} reports.` : ""}
      ${repeatAreasArr.length ? `Repeat incident areas include ${repeatAreasArr.map(a => `${a.barangay}, ${a.city}`).join('; ')}.` : ""}
      These trends suggest a need for targeted interventions in high-report areas and among vulnerable age groups.
    `.replace(/\s+/g, " ").trim();

    // Prepare response data
    res.status(statusCodes.OK).json({
      success: true,
      data: {
        charts: {
          byAgeCategory: formatForChart(stats.byAgeCategory),
          byGender: formatForChart(stats.byGender),
          byCity: formatForChart(stats.byCity),
          byBarangay: formatForChart(stats.byBarangay),
          byPoliceStation: formatForChart(stats.byPoliceStation),
          byReportType: formatForChart(stats.byReportType),
          byStatus: formatForChart(stats.byStatus),
          monthlyTrend: {
            labels: monthlyTrendArr.map(m => m.month),
            values: monthlyTrendArr.map(m => m.count)
          },
          ageCategoryVsResolutionTimeScatter: {
            // For chart.js scatter: datasets: [{ label, data: [{x, y, label}] }]
            labels: Object.keys(ageCategoryMap),
            datasets: [
              {
                label: 'Age Category vs. Resolution Time (hours)',
                data: scatterData,
                backgroundColor: '#36A2EB'
              }
            ],
            xAxis: {
              label: 'Age Category (1=Infant, 2=Child, 3=Teen, 4=Young Adult, 5=Adult, 6=Senior)',
              categories: ageCategoryMap
            },
            yAxis: {
              label: 'Resolution Time (hours)'
            }
          }
        },
        summary: {
          overview: {
            totalReports: total,
            trend: trendText,
            trendDirection,
            spikeText,
            avgResolutionTime,
            fastestResolutionTime
          },
          ageCategory: countAndPercent(stats.byAgeCategory, total),
          gender: genderArr,
          genderDifferential: genderDiffText,
          city: countAndPercent(stats.byCity, total),
          barangay: countAndPercent(stats.byBarangay, total),
          policeStation: countAndPercent(stats.byPoliceStation, total),
          topCities,
          topBarangays,
          topStations,
          reportType: typeArr,
          mostCommonType,
          status: countAndPercent(stats.byStatus, total),
          unresolvedPercent,
          alarmingChildText,
          crossCategory: {
            ...crossCategory,
            longPendingCases,
            repeatReportersArr,
            repeatAreasArr
          },
          summaryParagraph
        },
        filters: {
          appliedFilters: {
            ageCategory,
            city,
            barangay,
            policeStationId,
            startDate,
            endDate,
            reportType,
            gender
          }
        }
      }
    });

  } catch (error) {
    console.error('Error in getUserDemographicsAnalysis:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: error.message
    });
  }
});

// Police Officer Rankings
exports.getOfficerRankings = asyncHandler(async (req, res) => {
  try {
    // Access control
    const userRole = req.user.roles[0];
    if (userRole === 'user' || userRole === 'police_officer') {
      return res.status(statusCodes.FORBIDDEN).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Dynamic filters
    const {
      ageCategory,
      city,
      barangay,
      policeStationId,
      policeStationName,
      startDate,
      endDate,
      reportType,
      gender
    } = req.query;

    // Officer filter base
    let officerQuery = { roles: 'police_officer' };

    // Police admin: restrict to their city
    if (userRole === 'police_admin') {
      if (!req.user.address?.city) {
        return res.status(statusCodes.BAD_REQUEST).json({
          success: false,
          message: 'Police admin must have an assigned city'
        });
      }
      officerQuery['address.city'] = req.user.address.city;
    }

    // City filter
    if (city) officerQuery['address.city'] = city;
    if (barangay) officerQuery['address.barangay'] = barangay;
    
    // Enhanced police station filtering
    if (policeStationId) {
      officerQuery.policeStation = policeStationId;
    }
    
    if (gender) officerQuery.gender = gender;

    // Get all officers matching filters
    const officers = await User.find(officerQuery)
      .select('_id firstName lastName rank policeStation address avatar profilePicture')
      .populate('policeStation', 'name address')
      .lean();

    if (!officers.length) {
      return res.status(statusCodes.OK).json({
        success: true,
        data: []
      });
    }

    // Additional filtering by police station name if provided
    let filteredOfficers = officers;
    if (policeStationName) {
      filteredOfficers = officers.filter(officer => 
        officer.policeStation && 
        officer.policeStation.name && 
        officer.policeStation.name.toLowerCase().includes(policeStationName.toLowerCase())
      );
      
      if (!filteredOfficers.length) {
        return res.status(statusCodes.OK).json({
          success: true,
          data: []
        });
      }
    }

    // Build report query for stats
    let reportQuery = {
      assignedOfficer: { $in: filteredOfficers.map(o => o._id) }
    };

    // Report filters
    if (reportType) reportQuery.type = reportType;
    if (startDate || endDate) {
      reportQuery.createdAt = {};
      if (startDate) reportQuery.createdAt.$gte = new Date(startDate);
      if (endDate) reportQuery.createdAt.$lte = new Date(endDate);
    }
    if (city) reportQuery['location.address.city'] = city;
    if (barangay) reportQuery['location.address.barangay'] = barangay;

    // Age category filter (on personInvolved.age)
    if (ageCategory) {
      const ageRanges = {
        'infant': { min: 0, max: 2 },
        'child': { min: 3, max: 12 },
        'teen': { min: 13, max: 19 },
        'young_adult': { min: 20, max: 35 },
        'adult': { min: 36, max: 59 },
        'senior': { min: 60, max: 150 }
      };
      if (ageRanges[ageCategory]) {
        reportQuery['personInvolved.age'] = {
          $gte: ageRanges[ageCategory].min,
          $lte: ageRanges[ageCategory].max
        };
      }
    }

    // Gender filter (on personInvolved.gender)
    if (gender) reportQuery['personInvolved.gender'] = gender;

    // Enhanced aggregate stats per officer with resolution times and trends
    const stats = await Report.aggregate([
      { $match: reportQuery },
      {
        $group: {
          _id: '$assignedOfficer',
          totalAssigned: { $sum: 1 },
          resolved: { $sum: { $cond: [{ $eq: ['$status', 'Resolved'] }, 1, 0] } },
          underInvestigation: { $sum: { $cond: [{ $eq: ['$status', 'Under Investigation'] }, 1, 0] } },
          transferred: { $sum: { $cond: [{ $eq: ['$status', 'Transferred'] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'Pending'] }, 1, 0] } },
          byType: {
            $push: { type: '$type', status: '$status', createdAt: '$createdAt', updatedAt: '$updatedAt' }
          },
          // Resolution times for resolved cases
          resolutionTimes: {
            $push: {
              $cond: [
                { $eq: ['$status', 'Resolved'] },
                {
                  $divide: [
                    { $subtract: ['$updatedAt', '$createdAt'] },
                    3600000 // Convert to hours
                  ]
                },
                null
              ]
            }
          },
          // Monthly distribution for trend analysis
          monthlyDistribution: {
            $push: {
              month: { $dateToString: { format: "%Y-%m", date: '$createdAt' } },
              status: '$status'
            }
          }
        }
      }
    ]);

    // Enhanced officer mapping with performance metrics
    const officerMap = {};
    filteredOfficers.forEach(officer => {
      officerMap[officer._id.toString()] = {
        ...officer,
        totalAssigned: 0,
        resolved: 0,
        underInvestigation: 0,
        transferred: 0,
        pending: 0,
        resolutionRate: 0,
        avgResolutionTime: 0,
        fastestResolutionTime: 0,
        workloadEfficiency: 0,
        specialization: {},
        monthlyTrend: {},
        performanceScore: 0,
        byType: {}
      };
    });

    // Calculate department averages for comparison
    let totalDeptAssigned = 0, totalDeptResolved = 0, allResolutionTimes = [];
    
    stats.forEach(stat => {
      const o = officerMap[stat._id.toString()];
      if (o) {
        o.totalAssigned = stat.totalAssigned;
        o.resolved = stat.resolved;
        o.underInvestigation = stat.underInvestigation;
        o.transferred = stat.transferred;
        o.pending = stat.pending;
        o.resolutionRate = stat.totalAssigned ? Math.round((stat.resolved / stat.totalAssigned) * 100) : 0;

        // Calculate resolution time metrics
        const validResolutionTimes = stat.resolutionTimes.filter(time => time !== null && time > 0);
        if (validResolutionTimes.length > 0) {
          o.avgResolutionTime = parseFloat((validResolutionTimes.reduce((a, b) => a + b, 0) / validResolutionTimes.length).toFixed(1));
          o.fastestResolutionTime = parseFloat(Math.min(...validResolutionTimes).toFixed(1));
          allResolutionTimes.push(...validResolutionTimes);
        }

        // Calculate workload efficiency (resolved per day)
        const daysSinceFirstCase = stat.monthlyDistribution.length > 0 ? 
          Math.max(1, (Date.now() - new Date(Math.min(...stat.monthlyDistribution.map(m => new Date(m.month))))) / (1000 * 60 * 60 * 24)) : 1;
        o.workloadEfficiency = parseFloat((stat.resolved / daysSinceFirstCase * 30).toFixed(2)); // Cases per month

        // By type breakdown with specialization scoring
        const typeBreakdown = {};
        stat.byType.forEach(item => {
          if (!typeBreakdown[item.type]) typeBreakdown[item.type] = { assigned: 0, resolved: 0 };
          typeBreakdown[item.type].assigned += 1;
          if (item.status === 'Resolved') typeBreakdown[item.type].resolved += 1;
        });
        
        o.byType = typeBreakdown;
        
        // Calculate specialization (type with highest resolution rate)
        let bestType = null, bestRate = 0;
        Object.entries(typeBreakdown).forEach(([type, data]) => {
          const rate = data.assigned > 0 ? (data.resolved / data.assigned) * 100 : 0;
          if (rate > bestRate && data.assigned >= 2) { // At least 2 cases to be considered
            bestRate = rate;
            bestType = type;
          }
        });
        o.specialization = { type: bestType, rate: Math.round(bestRate) };

        // Monthly trend analysis
        const monthlyStats = {};
        stat.monthlyDistribution.forEach(item => {
          if (!monthlyStats[item.month]) monthlyStats[item.month] = { total: 0, resolved: 0 };
          monthlyStats[item.month].total += 1;
          if (item.status === 'Resolved') monthlyStats[item.month].resolved += 1;
        });
        o.monthlyTrend = monthlyStats;

        // Performance score (weighted combination of metrics)
        const resolutionWeight = 0.4;
        const efficiencyWeight = 0.3;
        const timeWeight = 0.3;
        
        const resolutionScore = o.resolutionRate;
        const efficiencyScore = Math.min(100, o.workloadEfficiency * 10); // Scale to 0-100
        const timeScore = o.avgResolutionTime > 0 ? Math.max(0, 100 - (o.avgResolutionTime / 24) * 20) : 50; // Lower time = higher score
        
        o.performanceScore = Math.round(
          (resolutionScore * resolutionWeight) + 
          (efficiencyScore * efficiencyWeight) + 
          (timeScore * timeWeight)
        );

        // Add to department totals
        totalDeptAssigned += stat.totalAssigned;
        totalDeptResolved += stat.resolved;
      }
    });

    // Calculate department averages
    const deptAvgResolutionRate = totalDeptAssigned > 0 ? Math.round((totalDeptResolved / totalDeptAssigned) * 100) : 0;
    const deptAvgResolutionTime = allResolutionTimes.length > 0 ? 
      parseFloat((allResolutionTimes.reduce((a, b) => a + b, 0) / allResolutionTimes.length).toFixed(1)) : 0;

    // Add percentile rankings
    const allOfficers = Object.values(officerMap);
    allOfficers.forEach(officer => {
      // Percentile for resolution rate
      const betterResolution = allOfficers.filter(o => o.resolutionRate < officer.resolutionRate).length;
      officer.resolutionPercentile = Math.round((betterResolution / allOfficers.length) * 100);
      
      // Percentile for performance score
      const betterPerformance = allOfficers.filter(o => o.performanceScore < officer.performanceScore).length;
      officer.performancePercentile = Math.round((betterPerformance / allOfficers.length) * 100);
    });

        // Get sortBy and sortOrder from query, with defaults
    const { sortBy = 'performanceScore', sortOrder = 'desc' } = req.query;

    // Enhanced sort fields
    const allowedSortFields = [
      'totalAssigned', 'resolved', 'underInvestigation', 'transferred', 'pending', 
      'resolutionRate', 'avgResolutionTime', 'workloadEfficiency', 'performanceScore'
    ];

    // Validate sortBy
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'performanceScore';

    // Sort officers dynamically
    const ranked = Object.values(officerMap).sort((a, b) => {
      if (sortOrder === 'asc') {
        return a[sortField] - b[sortField];
      } else {
        return b[sortField] - a[sortField];
      }
    });

    // Prepare chart data for frontend visualization
    const chartData = {
      // Bar chart: Officer performance comparison
      performanceBarChart: {
        labels: ranked.slice(0, 10).map(o => `${o.firstName} ${o.lastName}`),
        datasets: [
          {
            label: 'Performance Score',
            data: ranked.slice(0, 10).map(o => o.performanceScore),
            backgroundColor: '#36A2EB'
          },
          {
            label: 'Resolution Rate (%)',
            data: ranked.slice(0, 10).map(o => o.resolutionRate),
            backgroundColor: '#4BC0C0'
          }
        ],
        // Include officer details for tooltips/avatars
        officerDetails: ranked.slice(0, 10).map(o => ({
          name: `${o.firstName} ${o.lastName}`,
          avatar: o.avatar.url || o.profilePicture || null,
          rank: o.rank,
          station: o.policeStation?.name || 'N/A'
        }))
      },

      // Radar chart: Multi-metric officer comparison (top 5)
      officerRadarChart: {
        labels: ['Resolution Rate', 'Avg Resolution Time (inv)', 'Workload Efficiency', 'Cases Resolved', 'Specialization Rate'],
        datasets: ranked.slice(0, 5).map((officer, index) => ({
          label: `${officer.firstName} ${officer.lastName}`,
          data: [
            officer.resolutionRate,
            officer.avgResolutionTime > 0 ? Math.max(0, 100 - (officer.avgResolutionTime / 24) * 20) : 50, // Inverted for better visualization
            Math.min(100, officer.workloadEfficiency * 10),
            Math.min(100, (officer.resolved / Math.max(...ranked.map(r => r.resolved))) * 100),
            officer.specialization.rate || 0
          ],
          backgroundColor: `rgba(${54 + index * 50}, ${162 + index * 30}, ${235 - index * 40}, 0.2)`,
          borderColor: `rgba(${54 + index * 50}, ${162 + index * 30}, ${235 - index * 40}, 1)`,
          // Include officer details
          officerInfo: {
            name: `${officer.firstName} ${officer.lastName}`,
            avatar: officer.avatar.url || officer.profilePicture || null,
            rank: officer.rank,
            station: officer.policeStation?.name || 'N/A'
          }
        }))
      },

      // Scatter plot: Resolution Rate vs Workload
      resolutionVsWorkloadScatter: {
        datasets: [{
          label: 'Officers',
          data: ranked.map(officer => ({
            x: officer.workloadEfficiency,
            y: officer.resolutionRate,
            label: `${officer.firstName} ${officer.lastName}`,
            rank: officer.rank,
            station: officer.policeStation?.name || 'N/A',
            avatar: officer.avatar.url || officer.profilePicture || null,
            id: officer._id
          })),
          backgroundColor: '#FF6384'
        }],
        xAxis: { label: 'Workload Efficiency (cases/month)' },
        yAxis: { label: 'Resolution Rate (%)' }
      },

      // Heatmap data: Officer performance by case type
      caseTypeHeatmap: {
        officers: ranked.slice(0, 15).map(o => ({
          name: `${o.firstName} ${o.lastName}`,
          avatar: o.avatar || o.profilePicture || null,
          rank: o.rank
        })),
        caseTypes: [...new Set(ranked.flatMap(o => Object.keys(o.byType)))],
        data: ranked.slice(0, 15).map(officer => 
          [...new Set(ranked.flatMap(o => Object.keys(o.byType)))].map(caseType => {
            const typeData = officer.byType[caseType];
            return typeData ? Math.round((typeData.resolved / typeData.assigned) * 100) : 0;
          })
        )
      },

      // Trend lines: Monthly performance trends (top 5 officers)
      monthlyTrendChart: {
        labels: [...new Set(ranked.flatMap(o => Object.keys(o.monthlyTrend)))].sort(),
        datasets: ranked.slice(0, 5).map((officer, index) => ({
          label: `${officer.firstName} ${officer.lastName}`,
          data: [...new Set(ranked.flatMap(o => Object.keys(o.monthlyTrend)))].sort().map(month => {
            const monthData = officer.monthlyTrend[month];
            return monthData ? Math.round((monthData.resolved / monthData.total) * 100) : 0;
          }),
          borderColor: `rgba(${54 + index * 50}, ${162 + index * 30}, ${235 - index * 40}, 1)`,
          fill: false,
          // Include officer details
          officerInfo: {
            name: `${officer.firstName} ${officer.lastName}`,
            avatar: officer.avatar.url || officer.profilePicture || null,
            rank: officer.rank,
            station: officer.policeStation?.name || 'N/A'
          }
        }))
      }
    };

    // Department analytics summary
    const departmentSummary = {
      totalOfficers: ranked.length,
      avgResolutionRate: deptAvgResolutionRate,
      avgResolutionTime: deptAvgResolutionTime,
      topPerformer: ranked[0] ? {
        name: `${ranked[0].firstName} ${ranked[0].lastName}`,
        score: ranked[0].performanceScore,
        resolutionRate: ranked[0].resolutionRate
      } : null,
      performanceDistribution: {
        excellent: ranked.filter(o => o.performanceScore >= 90).length,
        good: ranked.filter(o => o.performanceScore >= 70 && o.performanceScore < 90).length,
        average: ranked.filter(o => o.performanceScore >= 50 && o.performanceScore < 70).length,
        needsImprovement: ranked.filter(o => o.performanceScore < 50).length
      },
      specializationBreakdown: Object.entries(
        ranked.reduce((acc, officer) => {
          if (officer.specialization.type) {
            acc[officer.specialization.type] = (acc[officer.specialization.type] || 0) + 1;
          }
          return acc;
        }, {})
      ).map(([type, count]) => ({ type, count }))
    };

    res.status(statusCodes.OK).json({
      success: true,
      data: {
        officers: ranked,
        charts: chartData,
        departmentSummary,
        metadata: {
          totalOfficers: ranked.length,
          dataGeneratedAt: new Date().toISOString(),
          performanceMetrics: [
            'resolutionRate', 'avgResolutionTime', 'workloadEfficiency', 
            'performanceScore', 'specialization'
          ]
        }
      },
      filters: {
        applied: { ageCategory, city, barangay, policeStationId, policeStationName, startDate, endDate, reportType, gender },
        sortBy,
        sortOrder
      }
    });

  } catch (error) {
    console.error('Error in getOfficerRankings:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: error.message
    });
  }
});


// Helper for role-based queries
const getRoleBasedQuery = async (user, baseQuery = {}) => {
  try {

    switch(user.roles[0]) {
      case 'police_officer':
      case 'police_admin':
        if (!user.policeStation) {
          throw new Error('Police officer/admin must have an assigned station');
        }
        return { 
          ...baseQuery, 
          assignedPoliceStation: user.policeStation 
        };
        
      case 'city_admin':
        if (!user.address?.city) {
          throw new Error('City admin must have an assigned city');
        }
        
        // Find all stations in the admin's city
        const cityStations = await PoliceStation.find({ 
          'address.city': user.address.city 
        });
        
        console.log('Found stations for city:', cityStations.length);

        // Return reports either in city or assigned to city stations
        return { 
          ...baseQuery,
          $or: [
            { 'location.address.city': user.address.city },
            { assignedPoliceStation: { 
              $in: cityStations.map(station => station._id) 
            }}
          ]
        };
        
      case 'super_admin':
        return baseQuery;
        
      default:
        throw new Error(`Invalid role: ${user.roles[0]}`);
    }
  } catch (error) {
    console.error('Error in getRoleBasedQuery:', error);
    throw error;
  }
};

  // Get Basic Analytics
exports.getBasicAnalytics = asyncHandler(async (req, res) => {
    try {
      const query = await getRoleBasedQuery(req.user);
      
      const analytics = await Promise.all([
        // Total Reports
        Report.countDocuments(query),
  
        // Reports by Type
        Report.aggregate([
          { $match: query },
          { $group: {
            _id: '$type',
            count: { $sum: 1 }
          }}
        ]),
  
        // Reports by Status
        Report.aggregate([
          { $match: query },
          { $group: {
            _id: '$status',
            count: { $sum: 1 }
          }}
        ]),
  
        // Today's Reports
        Report.countDocuments({
          ...query,
          createdAt: {
            $gte: new Date(new Date().setHours(0, 0, 0)),
            $lt: new Date(new Date().setHours(23, 59, 59))
          }
        }),
  
        // This Week's Reports
        Report.countDocuments({
          ...query,
          createdAt: {
            $gte: new Date(new Date().setDate(new Date().getDate() - 7)),
            $lt: new Date()
          }
        }),
  
        // Resolution Rate
        Report.aggregate([
          { $match: query },
          { $group: {
            _id: null,
            total: { $sum: 1 },
            resolved: {
              $sum: { $cond: [{ $eq: ['$status', 'Resolved'] }, 1, 0] }
            }
          }}
        ]),
  
        // Average Response Time (in hours)
        Report.aggregate([
          { 
            $match: { 
              ...query,
              status: 'Resolved'
            } 
          },
          { 
            $project: {
              responseTime: {
                $divide: [
                  { $subtract: ['$updatedAt', '$createdAt'] },
                  3600000 // Convert to hours
                ]
              }
            }
          },
          {
            $group: {
              _id: null,
              averageTime: { $avg: '$responseTime' }
            }
          }
        ])
      ]);
  
      const [
        totalReports,
        reportsByType,
        reportsByStatus,
        todayReports,
        weeklyReports,
        resolutionRate,
        responseTime
      ] = analytics;
  
      // Calculate percentages and format data
      const resolvedPercentage = resolutionRate[0] 
        ? Math.round((resolutionRate[0].resolved / resolutionRate[0].total) * 100) 
        : 0;
  
      const averageResponseTime = responseTime[0]
        ? Math.round(responseTime[0].averageTime)
        : 0;
  
      // Format type distribution
      const typeDistribution = reportsByType.reduce((acc, curr) => {
        acc[curr._id] = curr.count;
        return acc;
      }, {});
  
      // Format status distribution
      const statusDistribution = reportsByStatus.reduce((acc, curr) => {
        acc[curr._id] = curr.count;
        return acc;
      }, {});
  
      res.status(statusCodes.OK).json({
        success: true,
        data: {
          overview: {
            total: totalReports,
            today: todayReports,
            thisWeek: weeklyReports,
            resolutionRate: `${resolvedPercentage}%`,
            averageResponseTime: `${averageResponseTime} hours`
          },
          distribution: {
            byType: typeDistribution,
            byStatus: statusDistribution
          },
          performance: {
            resolved: resolutionRate[0]?.resolved || 0,
            pending: statusDistribution['Pending'] || 0,
            inProgress: statusDistribution['Under Investigation'] || 0
          }
        }
      });
  
    } catch (error) {
      console.error('Error in getBasicAnalytics:', error);
      res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        error: error.message
      });
    }
  });

// Type Distribution Chart
exports.getTypeDistribution = asyncHandler(async (req, res) => {
  try {
    const query = await getRoleBasedQuery(req.user);
    const data = await Report.aggregate([
      { $match: query },
      { $group: {
        _id: '$type',
        count: { $sum: 1 }
      }},
      { $sort: { count: -1 } }
    ]);

    res.status(statusCodes.OK).json({
      success: true,
      data: {
        labels: data.map(item => item._id),
        datasets: [{
          data: data.map(item => item.count),
          backgroundColor: [
            '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF'
          ]
        }]
      }
    });
  } catch (error) {
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: error.message
    });
  }
});

// Status Distribution Chart
exports.getStatusDistribution = asyncHandler(async (req, res) => {
  try {
    const query = await getRoleBasedQuery(req.user);
    const data = await Report.aggregate([
      { $match: query },
      { $group: {
        _id: '$status',
        count: { $sum: 1 }
      }},
      { $sort: { count: -1 } }
    ]);

    res.status(statusCodes.OK).json({
      success: true,
      data: {
        labels: data.map(item => item._id),
        datasets: [{
          data: data.map(item => item.count),
          backgroundColor: [
            '#FF9F40', '#4BC0C0', '#FF6384', '#36A2EB', '#9966FF'
          ]
        }]
      }
    });
  } catch (error) {
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: error.message
    });
  }
});

// Monthly Trend Chart
exports.getMonthlyTrend = asyncHandler(async (req, res) => {
  try {
    const query = await getRoleBasedQuery(req.user);
    const data = await Report.aggregate([
      { $match: query },
      { $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' }
        },
        count: { $sum: 1 }
      }},
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    const months = data.map(item => {
      const date = new Date(item._id.year, item._id.month - 1);
      return date.toLocaleString('default', { month: 'short', year: '2-digit' });
    });

    res.status(statusCodes.OK).json({
      success: true,
      data: {
        labels: months,
        datasets: [{
          label: 'Reports',
          data: data.map(item => item.count),
          borderColor: '#36A2EB',
          fill: false
        }]
      }
    });
  } catch (error) {
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: error.message
    });
  }
});


exports.getLocationHotspots = asyncHandler(async (req, res) => {
  try {
    const { barangay, reportType, startDate, endDate, cityFilter } = req.query;

    // Get base query from role
    let query = await getRoleBasedQuery(req.user);

    // Add filters to query
    if (barangay) query['location.address.barangay'] = barangay;
    if (reportType) query.type = reportType;
    if (cityFilter) query['location.address.city'] = cityFilter;

    // Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    // Get historical data by barangay and time
    const historicalData = await Report.aggregate([
      { $match: query },
      { 
        $group: {
          _id: {
            barangay: '$location.address.barangay',
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            type: '$type'
          },
          count: { $sum: 1 },
          cases: {
            $push: {
              type: '$type',
              status: '$status',
              createdAt: '$createdAt'
            }
          }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // Process data for each barangay
    const barangayStats = {};
    historicalData.forEach(entry => {
      const barangay = entry._id.barangay;
      if (!barangayStats[barangay]) {
        barangayStats[barangay] = {
          totalIncidents: 0,
          monthlyData: [],
          trend: 0,
          caseTypes: {},
          monthlyBreakdown: []
        };
      }
      
      barangayStats[barangay].totalIncidents += entry.count;
      barangayStats[barangay].monthlyData.push(entry.count);

      // Track case types
      entry.cases.forEach(case_ => {
        if (!barangayStats[barangay].caseTypes[case_.type]) {
          barangayStats[barangay].caseTypes[case_.type] = 0;
        }
        barangayStats[barangay].caseTypes[case_.type]++;
      });

      // Monthly breakdown
      barangayStats[barangay].monthlyBreakdown.push({
        year: entry._id.year,
        month: entry._id.month,
        count: entry.count,
        type: entry._id.type
      });
    });

    // Calculate trends and predictions
    Object.keys(barangayStats).forEach(barangay => {
      const stats = barangayStats[barangay];
      const monthlyData = stats.monthlyData;
      
      if (monthlyData.length > 1) {
        const n = monthlyData.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        
        monthlyData.forEach((count, index) => {
          const weight = Math.exp(index / n);
          sumX += index * weight;
          sumY += count * weight;
          sumXY += index * count * weight;
          sumXX += index * index * weight;
        });

        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        stats.trend = slope;

        const recentMonths = monthlyData.slice(-3);
        const weightedAvg = recentMonths.reduce((acc, val, idx) => 
          acc + val * Math.exp(idx), 0) / recentMonths.length;
        
        stats.prediction = Math.max(0, Math.round(weightedAvg + slope));
      }

      const maxIncidents = Math.max(...Object.values(barangayStats).map(s => s.totalIncidents));
      const trendFactor = stats.trend > 0 ? 1.2 : stats.trend < 0 ? 0.8 : 1;
      stats.riskScore = Math.round((stats.totalIncidents / maxIncidents) * 100 * trendFactor);
    });

    // Sort barangays by risk score
    const sortedBarangays = Object.entries(barangayStats)
      .sort((a, b) => b[1].riskScore - a[1].riskScore)
      .slice(0, 10);

    res.status(statusCodes.OK).json({
      success: true,
      data: {
        current: {
          labels: sortedBarangays.map(([barangay]) => barangay),
          datasets: [{
            label: 'Current Incidents',
            data: sortedBarangays.map(([_, stats]) => stats.totalIncidents)
          }]
        },
        predictions: {
          labels: sortedBarangays.map(([barangay]) => barangay),
          datasets: [{
            label: 'Predicted Next Month',
            data: sortedBarangays.map(([_, stats]) => stats.prediction || 0)
          }]
        },
        analysis: sortedBarangays.map(([barangay, stats]) => ({
          barangay,
          currentIncidents: stats.totalIncidents,
          predictedNextMonth: stats.prediction || 0,
          riskScore: stats.riskScore,
          caseTypes: stats.caseTypes,
          monthlyBreakdown: stats.monthlyBreakdown,
          trend: stats.trend > 0 ? 'Increasing' : stats.trend < 0 ? 'Decreasing' : 'Stable',
          riskLevel: stats.riskScore >= 75 ? 'High' : stats.riskScore >= 50 ? 'Medium' : 'Low'
        })),
        filters: {
          appliedFilters: { barangay, reportType, startDate, endDate, cityFilter }
        }
      }
    });

  } catch (error) {
    console.error('Error in getLocationHotspots:', error);
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: error.message
    });
  }
});

// Enhanced Police Station Filtering Documentation
// The function now supports multiple police station filtering options:
// 
// 1. policeStationId - Filter by exact police station ObjectId
//    Example: GET /api/v1/charts/officer-rankings?policeStationId=67618c86c93d34d5109ce96f
//
// 2. policeStationName - Filter by police station name (partial match, case-insensitive)
//    Example: GET /api/v1/charts/officer-rankings?policeStationName=Taguig
//    Example: GET /api/v1/charts/officer-rankings?policeStationName=Tenement
//
// 3. city - Filter officers by their assigned city (affects both officer location and police station location)
//    Example: GET /api/v1/charts/officer-rankings?city=Taguig
//
// 4. Combined filters for precise targeting:
//    Example: GET /api/v1/charts/officer-rankings?city=Taguig&policeStationName=Tenement&startDate=2024-01-01

module.exports = exports;