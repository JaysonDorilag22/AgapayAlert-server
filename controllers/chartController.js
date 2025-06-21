const Report = require('../models/reportModel');
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
      gender
    } = req.query;

    // Get base query from role
    let query = await getRoleBasedQuery(req.user);

    // Add filters to query
    if (city) query['location.address.city'] = city;
    if (barangay) query['location.address.barangay'] = barangay;
    if (policeStationId) query.assignedPoliceStation = policeStationId;
    if (reportType) query.type = reportType;

    // Handle age category filter if provided
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

    // Handle gender filter
    if (gender) {
      query['personInvolved.gender'] = gender;
    }

    // Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    // Get reports with needed fields
    const reports = await Report.find(query)
      .populate('reporter', 'age address gender')
      .populate('assignedPoliceStation', 'name address')
      .select('personInvolved location type status createdAt')
      .lean();

    // Process reports into statistical categories
    const stats = {
      total: reports.length,
      byAgeCategory: {},
      byCity: {},
      byBarangay: {},
      byGender: {},
      byPoliceStation: {},
      byReportType: {},
      byStatus: {}
    };
    
    // Process each report to build statistics
    reports.forEach(report => {
      // Age category grouping
      const age = report.personInvolved.age || 0;
      let ageCategory;
      if (age <= 2) ageCategory = 'Infant (0-2)';
      else if (age <= 12) ageCategory = 'Child (3-12)';
      else if (age <= 19) ageCategory = 'Teen (13-19)';
      else if (age <= 35) ageCategory = 'Young Adult (20-35)';
      else if (age <= 59) ageCategory = 'Adult (36-59)';
      else ageCategory = 'Senior (60+)';

      stats.byAgeCategory[ageCategory] = (stats.byAgeCategory[ageCategory] || 0) + 1;

      // City grouping
      const city = report.location.address.city;
      if (city) {
        stats.byCity[city] = (stats.byCity[city] || 0) + 1;
      }

      // Barangay grouping
      const barangay = report.location.address.barangay;
      if (barangay) {
        stats.byBarangay[barangay] = (stats.byBarangay[barangay] || 0) + 1;
      }

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
    });

    // Convert stats to chart-friendly format
    const formatForChart = (data) => {
      const labels = Object.keys(data);
      const values = labels.map(label => data[label]);
      return { labels, values };
    };
    
    // Define age category order for consistent display
    const ageCategoryOrder = [
      'Infant (0-2)', 
      'Child (3-12)', 
      'Teen (13-19)', 
      'Young Adult (20-35)', 
      'Adult (36-59)', 
      'Senior (60+)'
    ];
    
    // Format age categories with proper order
    const formattedAgeCategories = {
      labels: ageCategoryOrder.filter(category => stats.byAgeCategory[category] !== undefined),
      values: ageCategoryOrder.filter(category => stats.byAgeCategory[category] !== undefined)
        .map(category => stats.byAgeCategory[category])
    };

    // Prepare response data
    const responseData = {
      overview: {
        totalReports: stats.total,
      },
      charts: {
        byAgeCategory: formattedAgeCategories,
        byCity: formatForChart(stats.byCity),
        byBarangay: formatForChart(stats.byBarangay),
        byGender: formatForChart(stats.byGender),
        byPoliceStation: formatForChart(stats.byPoliceStation),
        byReportType: formatForChart(stats.byReportType),
        byStatus: formatForChart(stats.byStatus)
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
        },
        availableCategories: {
          ageCategories: [
            { value: 'infant', label: 'Infant (0-2)' },
            { value: 'child', label: 'Child (3-12)' },
            { value: 'teen', label: 'Teen (13-19)' },
            { value: 'young_adult', label: 'Young Adult (20-35)' },
            { value: 'adult', label: 'Adult (36-59)' },
            { value: 'senior', label: 'Senior (60+)' }
          ]
        }
      }
    };

    res.status(statusCodes.OK).json({
      success: true,
      data: responseData
    });

  } catch (error) {
    console.error('Error in getUserDemographicsAnalysis:', error);
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

module.exports = exports;