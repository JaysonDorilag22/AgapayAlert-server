const express = require('express');
const http = require('http');
const cors = require('cors');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const passport = require('./config/passportConfig');
const path = require('path');
const { initializeSocket } = require('./utils/socketUtils');
const connectDB = require('./config/db');
const errorHandler = require('./middlewares/errorHandler');
const MongoStore = require('connect-mongo');
const cron = require('node-cron');
const mongoose = require('mongoose');
const axios = require('axios');
// Route imports
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const reportRoutes = require("./routes/reportRoutes");
const cityRoutes = require("./routes/cityRoutes");
const policeStationRoutes = require("./routes/policeStationRoutes");
const finderReportRoutes = require("./routes/finderReportRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const chartRoutes = require("./routes/chartRoutes");
const alprRoutes = require("./routes/alprRoutes");
const feedbackRoutes = require("./routes/feedbackRoutes");
const messengerRoutes = require("./routes/messengerRoutes");
const emergencyContactRoutes = require("./routes/emergencyContactRoutes");
const customPostRoutes = require("./routes/customPostRoutes");
const { initializeMessenger } = require("./controllers/messengerController");
const { updateAbsentToMissingReports } = require('./controllers/reportController');
// Load env vars
dotenv.config();

// Initialize express and create HTTP server
const app = express();
const server = http.createServer(app);

// Initialize socket.io
initializeSocket(server);

// Connect to database
connectDB();

// Middleware

// CORS Configuration
const allowedOrigins = [
  process.env.CLIENT_URL || "http://localhost:3000",
  process.env.MOBILE_URL || "exp://192.168.1.1:19000",
  process.env.server || "http://localhost:5173",
  "https://agapayalert-web.onrender.com",
  "https://agapayalert-server.onrender.com",
  "agapayalert://"
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  credentials: true,
  maxAge: 86400 // 24 hours
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Session configuration
app.use(
  session({
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      ttl: 24 * 60 * 60, // = 1 day
    }),
    secret: process.env.SESSION_SECRET || "secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// View engine setup
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Health check route
app.get("/", (req, res) => {
  res.status(200).json({ status: "OK", message: "Server is running" });
});

// Add MongoDB storage monitoring function
const getMongoDBStorageInfo = async () => {
  try {
    const db = mongoose.connection.db;
    const admin = db.admin();
    
    // Get database stats
    const dbStats = await db.stats();
    
    // Get server status (includes storage info)
    const serverStatus = await admin.serverStatus();
    
    // Calculate storage info
    const storageInfo = {
      database: {
        dataSize: dbStats.dataSize,
        indexSize: dbStats.indexSize,
        storageSize: dbStats.storageSize,
        totalSize: dbStats.dataSize + dbStats.indexSize,
        collections: dbStats.collections,
        documents: dbStats.objects,
        avgObjSize: dbStats.avgObjSize
      },
      server: {
        version: serverStatus.version,
        uptime: serverStatus.uptime,
        connections: serverStatus.connections
      },
      formatted: {
        dataSize: (dbStats.dataSize / (1024 * 1024)).toFixed(2) + ' MB',
        indexSize: (dbStats.indexSize / (1024 * 1024)).toFixed(2) + ' MB',
        storageSize: (dbStats.storageSize / (1024 * 1024)).toFixed(2) + ' MB',
        totalSize: ((dbStats.dataSize + dbStats.indexSize) / (1024 * 1024)).toFixed(2) + ' MB'
      }
    };
    
    return storageInfo;
  } catch (error) {
    console.error('Error fetching MongoDB storage info:', error);
    throw error;
  }
};
app.get('/api/v1/proxy/cities', async (req, res) => {
  try {
    const response = await axios.get('https://psgc.gitlab.io/api/cities.json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch cities', error: error.message });
  }
});

app.get('/api/v1/proxy/barangays/:cityCodes', async (req, res) => {
  try {
    const { cityCodes } = req.params;
    const codesArray = cityCodes.split(',');
    const allBarangays = [];

    for (const code of codesArray) {
      const response = await axios.get(`https://psgc.gitlab.io/api/cities/${code}/barangays.json`);
      allBarangays.push(...response.data);
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(allBarangays);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch barangays', error: error.message });
  }
});

app.get("/api/v1/storage/info", async (req, res) => {
  try {
    const storageInfo = await getMongoDBStorageInfo();
    res.status(200).json({
      success: true,
      data: storageInfo
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch storage information",
      error: error.message
    });
  }
});
app.get("/api/v1/storage/capacity", async (req, res) => {
  try {
    const storageInfo = await getMongoDBStorageInfo();
    
    // MongoDB Atlas free tier limit is 512MB
    const FREE_TIER_LIMIT = 512 * 1024 * 1024; // 512MB in bytes
    const currentUsage = storageInfo.database.totalSize;
    const usagePercentage = ((currentUsage / FREE_TIER_LIMIT) * 100).toFixed(2);
    
    const capacityInfo = {
      currentUsage: currentUsage,
      currentUsageFormatted: storageInfo.formatted.totalSize,
      limit: FREE_TIER_LIMIT,
      limitFormatted: '512 MB',
      usagePercentage: parseFloat(usagePercentage),
      remainingSpace: FREE_TIER_LIMIT - currentUsage,
      remainingSpaceFormatted: ((FREE_TIER_LIMIT - currentUsage) / (1024 * 1024)).toFixed(2) + ' MB',
      isNearLimit: usagePercentage > 80,
      isOverLimit: usagePercentage > 100
    };
    
    res.status(200).json({
      success: true,
      data: capacityInfo
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch capacity information",
      error: error.message
    });
  }
});


// API Routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/user", userRoutes);
app.use("/api/v1/report", reportRoutes);
app.use("/api/v1/cities", cityRoutes);
app.use("/api/v1/police-station", policeStationRoutes);
app.use("/api/v1/finder", finderReportRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/charts", chartRoutes);
app.use("/api/v1/alpr", alprRoutes);
app.use("/api/v1/feedback", feedbackRoutes);
app.use("/api/messenger", messengerRoutes);
app.use("/api/v1/emergency-contacts", emergencyContactRoutes)
app.use("/api/v1/custom-posts", customPostRoutes);
// Error handling
app.use(errorHandler);

// Handle 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Run every hour
cron.schedule('0 * * * *', async () => {
  try {
    console.log('Running automatic Absent → Missing update check...');
    const result = await updateAbsentToMissingReports();
    console.log(`Update complete: ${result.updatedCount} reports updated`);
  } catch (error) {
    console.error('Scheduled task error:', error);
  }
});
//messenger
const startServer = async () => {
  try {
    const PORT = process.env.PORT || 3000;

    console.log("Initializing Messenger...");
    const messengerInitialized = await initializeMessenger();
    if (!messengerInitialized) {
      console.warn("⚠️ Messenger initialization failed, but server will continue");
    }

    server.listen(PORT, () => {
      console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

// Start server
startServer();
// Handle unhandled promise rejections
process.on("unhandledRejection", (err) => {
  console.log("UNHANDLED REJECTION! 💥 Shutting down...");
  console.log(err.name, err.message);
  server.close(() => {
    process.exit(1);
  });
});
