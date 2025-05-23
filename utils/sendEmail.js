// filepath: /c:/Desktop/CAPSTONE/AgapayAlert-server/utils/sendEmail.js

const transporter = require('../config/mailtrapConfig');
const ejs = require('ejs');
const path = require('path');

/**
 * Send an email using the configured transporter.
 * @param {Object} mailOptions - The mail options.
 * @param {string} mailOptions.from - The sender address.
 * @param {string} mailOptions.to - The recipient address.
 * @param {string} mailOptions.subject - The subject of the email.
 * @param {string} mailOptions.template - The path to the EJS template.
 * @param {Object} mailOptions.context - The context to pass to the EJS template.
 * @returns {Promise} - A promise that resolves when the email is sent.
 */
const sendEmail = async (mailOptions) => {
  try {
    const templatePath = path.join(__dirname, '..', 'views', mailOptions.template);
    const html = await ejs.renderFile(templatePath, mailOptions.context);

    const options = {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject,
      html: html,
    };

    await transporter.sendMail(options);
    console.log('Email sent successfully');
  } catch (error) {
    console.error('Error sending email:', error);
    throw new Error('Failed to send email');
  }
};

module.exports = sendEmail;