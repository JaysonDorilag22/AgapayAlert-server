const nodemailer = require('nodemailer');
const dotenv = require('dotenv');

dotenv.config();

// const transporter = nodemailer.createTransport({
//   service: 'gmail',
//   auth: {
//     user: process.env.GMAIL_USER,
//     pass: process.env.GMAIL_APP_PASSWORD 
//   }
// });

// module.exports = transporter;

//use this for mail trap
// const nodemailer = require('nodemailer');
// const dotenv = require('dotenv');

// dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.MAILTRAP_HOST,
  port: process.env.MAILTRAP_PORT,
  auth: {
    user: process.env.MAILTRAP_USER,
    pass: process.env.MAILTRAP_PASS
  }
});

module.exports = transporter;