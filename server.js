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
// Route imports
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const reportRoutes = require('./routes/reportRoutes');
const cityRoutes = require('./routes/cityRoutes');
const policeStationRoutes = require('./routes/policeStationRoutes');
const finderReportRoutes = require('./routes/finderReportRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const chartRoutes = require('./routes/chartRoutes');
const alprRoutes = require('./routes/alprRoutes');
const feedbackRoutes = require('./routes/feedbackRoutes');
const messengerRoutes = require('./routes/messngerRoutes');
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
app.use(cors({
    origin: [
        process.env.CLIENT_URL || "http://localhost:3000",
        process.env.MOBILE_URL || "exp://192.168.1.1:19000"
    ],
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Session configuration
app.use(session({ 
  store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      ttl: 24 * 60 * 60 // = 1 day
  }),
  secret: process.env.SESSION_SECRET || 'secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Health check route
app.get('/', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'Server is running' });
});

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/user', userRoutes);
app.use('/api/v1/report', reportRoutes);
app.use('/api/v1/city', cityRoutes);
app.use('/api/v1/police-station', policeStationRoutes);
app.use('/api/v1/report-finder', finderReportRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/charts', chartRoutes);
app.use('/api/v1/alpr', alprRoutes);
app.use('/api/v1/feedback', feedbackRoutes);
app.use('/api/messenger', messengerRoutes);
// Error handling
app.use(errorHandler);

// Handle 404
app.use((req, res) => {
    res.status(404).json({ 
        success: false, 
        message: 'Route not found' 
    });
});

//messenger

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
    console.log('UNHANDLED REJECTION! 💥 Shutting down...');
    console.log(err.name, err.message);
    server.close(() => {
        process.exit(1);
    });
});