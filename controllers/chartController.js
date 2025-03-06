const Report = require('../models/reportModel');
const PoliceStation = require('../models/policeStationModel');
const asyncHandler = require('express-async-handler');
const statusCodes = require('../constants/statusCodes');

// This function filters data based on user roles:

// Police Officer/Admin

// Can only see reports from their assigned police station
// Filtered by: assignedPoliceStation
// City Admin

// Can see all reports in their city
// Shows reports that are either:
// Located in their city OR
// Assigned to any police station in their city
// Super Admin

// No filters applied
// Can see all reports nationwide

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

// Location Hotspots Chart with Predictive Analysis
exports.getLocationHotspots = asyncHandler(async (req, res) => {
    try {
      const query = await getRoleBasedQuery(req.user);
      
      // Get historical data by barangay and time
      const historicalData = await Report.aggregate([
        { $match: query },
        { 
          $group: {
            _id: {
              barangay: '$location.address.barangay',
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' }
            },
            count: { $sum: 1 }
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
            trend: 0
          };
        }
        
        barangayStats[barangay].totalIncidents += entry.count;
        barangayStats[barangay].monthlyData.push(entry.count);
      });
  
      // Calculate trends and predictions
      Object.keys(barangayStats).forEach(barangay => {
        const stats = barangayStats[barangay];
        const monthlyData = stats.monthlyData;
        
        // Calculate trend (simple linear regression)
        if (monthlyData.length > 1) {
          const n = monthlyData.length;
          let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
          
          monthlyData.forEach((count, index) => {
            sumX += index;
            sumY += count;
            sumXY += index * count;
            sumXX += index * index;
          });
  
          const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
          stats.trend = slope;
  
          // Predict next month's incidents
          stats.prediction = Math.max(0, Math.round(
            monthlyData[monthlyData.length - 1] + slope
          ));
        }
  
        // Calculate risk score (0-100)
        const maxIncidents = Math.max(...Object.values(barangayStats).map(s => s.totalIncidents));
        stats.riskScore = Math.round((stats.totalIncidents / maxIncidents) * 100);
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
              data: sortedBarangays.map(([_, stats]) => stats.totalIncidents),
              backgroundColor: '#36A2EB'
            }]
          },
          predictions: {
            labels: sortedBarangays.map(([barangay]) => barangay),
            datasets: [{
              label: 'Predicted Next Month',
              data: sortedBarangays.map(([_, stats]) => stats.prediction || 0),
              backgroundColor: '#FF6384'
            }]
          },
          analysis: sortedBarangays.map(([barangay, stats]) => ({
            barangay,
            currentIncidents: stats.totalIncidents,
            predictedNextMonth: stats.prediction || 0,
            riskScore: stats.riskScore,
            trend: stats.trend > 0 ? 'Increasing' : stats.trend < 0 ? 'Decreasing' : 'Stable',
            riskLevel: stats.riskScore >= 75 ? 'High' : stats.riskScore >= 50 ? 'Medium' : 'Low'
          }))
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

  // Example API call
// GET /api/charts/hotspots?barangay=Lahug&reportType=Missing&startDate=2023-01-01&endDate=2023-12-31&cityFilter=Cebu City


//   exports.getLocationHotspots = asyncHandler(async (req, res) => {
//     try {
//       const { 
//         barangay,
//         reportType,
//         startDate,
//         endDate,
//         cityFilter
//       } = req.query;

//       // Get base query from role
//       let query = await getRoleBasedQuery(req.user);

//       // Add filters to query
//       if (barangay) {
//         query['location.address.barangay'] = barangay;
//       }

//       if (reportType) {
//         query.type = reportType;
//       }

//       if (cityFilter) {
//         query['location.address.city'] = cityFilter;
//       }

//       // Date range filter
//       if (startDate || endDate) {
//         query.createdAt = {};
//         if (startDate) {
//           query.createdAt.$gte = new Date(startDate);
//         }
//         if (endDate) {
//           query.createdAt.$lte = new Date(endDate);
//         }
//       }
      
//       // Get historical data by barangay and time
//       const historicalData = await Report.aggregate([
//         { $match: query },
//         { 
//           $group: {
//             _id: {
//               barangay: '$location.address.barangay',
//               year: { $year: '$createdAt' },
//               month: { $month: '$createdAt' },
//               type: '$type'
//             },
//             count: { $sum: 1 },
//             cases: {
//               $push: {
//                 type: '$type',
//                 status: '$status',
//                 createdAt: '$createdAt'
//               }
//             }
//           }
//         },
//         { $sort: { '_id.year': 1, '_id.month': 1 } }
//       ]);
  
//       // Process data for each barangay
//       const barangayStats = {};
//       historicalData.forEach(entry => {
//         const barangay = entry._id.barangay;
//         if (!barangayStats[barangay]) {
//           barangayStats[barangay] = {
//             totalIncidents: 0,
//             monthlyData: [],
//             trend: 0,
//             caseTypes: {},
//             monthlyBreakdown: []
//           };
//         }
        
//         barangayStats[barangay].totalIncidents += entry.count;
//         barangayStats[barangay].monthlyData.push(entry.count);

//         // Track case types
//         entry.cases.forEach(case_ => {
//           if (!barangayStats[barangay].caseTypes[case_.type]) {
//             barangayStats[barangay].caseTypes[case_.type] = 0;
//           }
//           barangayStats[barangay].caseTypes[case_.type]++;
//         });

//         // Monthly breakdown
//         barangayStats[barangay].monthlyBreakdown.push({
//           year: entry._id.year,
//           month: entry._id.month,
//           count: entry.count,
//           type: entry._id.type
//         });
//       });
  
//       // Calculate trends and predictions
//       Object.keys(barangayStats).forEach(barangay => {
//         const stats = barangayStats[barangay];
//         const monthlyData = stats.monthlyData;
        
//         // Enhanced trend calculation with weighted recent months
//         if (monthlyData.length > 1) {
//           const n = monthlyData.length;
//           let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
          
//           monthlyData.forEach((count, index) => {
//             // Give more weight to recent months
//             const weight = Math.exp(index / n);
//             sumX += index * weight;
//             sumY += count * weight;
//             sumXY += index * count * weight;
//             sumXX += index * index * weight;
//           });
  
//           const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
//           stats.trend = slope;
  
//           // Improved prediction using weighted average
//           const recentMonths = monthlyData.slice(-3);
//           const weightedAvg = recentMonths.reduce((acc, val, idx) => 
//             acc + val * Math.exp(idx), 0) / recentMonths.length;
          
//           stats.prediction = Math.max(0, Math.round(
//             weightedAvg + slope
//           ));
//         }
  
//         // Enhanced risk score calculation
//         const maxIncidents = Math.max(...Object.values(barangayStats).map(s => s.totalIncidents));
//         const trendFactor = stats.trend > 0 ? 1.2 : stats.trend < 0 ? 0.8 : 1;
//         stats.riskScore = Math.round((stats.totalIncidents / maxIncidents) * 100 * trendFactor);
//       });
  
//       // Sort barangays by risk score
//       const sortedBarangays = Object.entries(barangayStats)
//         .sort((a, b) => b[1].riskScore - a[1].riskScore)
//         .slice(0, 10);
  
//       res.status(statusCodes.OK).json({
//         success: true,
//         data: {
//           current: {
//             labels: sortedBarangays.map(([barangay]) => barangay),
//             datasets: [{
//               label: 'Current Incidents',
//               data: sortedBarangays.map(([_, stats]) => stats.totalIncidents),
//               backgroundColor: '#36A2EB'
//             }]
//           },
//           predictions: {
//             labels: sortedBarangays.map(([barangay]) => barangay),
//             datasets: [{
//               label: 'Predicted Next Month',
//               data: sortedBarangays.map(([_, stats]) => stats.prediction || 0),
//               backgroundColor: '#FF6384'
//             }]
//           },
//           analysis: sortedBarangays.map(([barangay, stats]) => ({
//             barangay,
//             currentIncidents: stats.totalIncidents,
//             predictedNextMonth: stats.prediction || 0,
//             riskScore: stats.riskScore,
//             caseTypes: stats.caseTypes,
//             monthlyBreakdown: stats.monthlyBreakdown,
//             trend: stats.trend > 0 ? 'Increasing' : stats.trend < 0 ? 'Decreasing' : 'Stable',
//             riskLevel: stats.riskScore >= 75 ? 'High' : stats.riskScore >= 50 ? 'Medium' : 'Low'
//           })),
//           filters: {
//             appliedFilters: {
//               barangay,
//               reportType,
//               startDate,
//               endDate,
//               cityFilter
//             }
//           }
//         }
//       });
  
//     } catch (error) {
//       console.error('Error in getLocationHotspots:', error);
//       res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
//         success: false,
//         error: error.message
//       });
//     }
// });

module.exports = exports;