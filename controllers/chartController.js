const Report = require('../models/reportModel');
const PoliceStation = require('../models/policeStationModel');
const asyncHandler = require('express-async-handler');
const statusCodes = require('../constants/statusCodes');

// Helper for role-based queries
const getRoleBasedQuery = async (user, baseQuery = {}) => {
    try {
      switch(user.roles[0]) {
        case 'police_officer':
        case 'police_admin':
          return { 
            ...baseQuery, 
            assignedPoliceStation: user.policeStation 
          };
          
        case 'city_admin':
          // Get all stations in the admin's city
          const cityStations = await PoliceStation.find({ 
            'address.city': user.address.city 
          });
          
          if(!cityStations.length) {
            throw new Error(`No police stations found in ${user.address.city}`);
          }
  
          return { 
            ...baseQuery,
            $or: [
              { 'location.address.city': user.address.city },
              { assignedPoliceStation: { $in: cityStations.map(station => station._id) } }
            ]
          };
          
        case 'super_admin':
          return baseQuery;
          
        default:
          throw new Error('Invalid role');
      }
    } catch (error) {
      console.error('Error in getRoleBasedQuery:', error);
      throw error;
    }
  };

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

module.exports = exports;