const express = require('express');
const connectDB = require('./config/db');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const passport = require('./config/passportConfig');
const session = require('express-session');
const errorHandler = require('./middlewares/errorHandler');
const path = require('path');

//Routes
const authRoutes = require('./routes/authRoutes');

dotenv.config();

const app = express();

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

// Error handler
app.use(errorHandler)

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));