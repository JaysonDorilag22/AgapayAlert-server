const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const passport = require('./config/passportConfig');
const session = require('express-session');
const errorHandler = require('./middlewares/errorHandler');
const path = require('path');

//Routes
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const reportRoutes = require('./routes/reportRoutes');
const cityRoutes = require('./routes/cityRoutes');
const policeStationRoutes = require('./routes/policeStationRoutes')
const finderReportRoutes = require('./routes/finderReportRoutes')
const notificationRoutes = require('./routes/notificationRoutes');

dotenv.config();

const app = express();
app.use(cors());

//connnect to database
connectDB();

// Middleware to parse JSON and cookies
app.use(express.json());
app.use(cookieParser());

// Initialize Passport and restore authentication state, if any, from the session
app.use(session({ secret: 'secret', resave: false, saveUninitialized: true }));
app.use(passport.initialize());
app.use(passport.session());

// Set EJS as templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));


// Test route
app.post('/', (req, res) => {
    res.status(200).json({ message: 'API running' });
  });

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/user', userRoutes);
app.use('/api/v1/report', reportRoutes);
app.use('/api/v1/city', cityRoutes);
app.use('/api/v1/police-station', policeStationRoutes)
app.use('/api/v1/report-finder', finderReportRoutes)
app.use('/api/v1/notifications', notificationRoutes);

// Error handler
app.use(errorHandler)

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));