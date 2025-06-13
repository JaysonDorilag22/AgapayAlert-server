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
    return { success: true };
  } catch (error) {
    console.error('Error sending email:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
};

const sendTransferEmailWithAttachments = async (context, recipients, attachments = []) => {
  try {
    const templatePath = path.join(__dirname, '..', 'views', 'reportTransferEmail.ejs');
    const html = await ejs.renderFile(templatePath, context);

    const mailOptions = {
      from: process.env.SMTP_FROM_EMAIL || 'no-reply@agapayalert.com',
      to: recipients.join(', '),
      subject: `AgapayAlert - ${context.reportType} Case Transfer - ${context.caseId}`,
      html: html,
      attachments: attachments
    };

    await transporter.sendMail(mailOptions);
    console.log('Transfer email with attachments sent successfully');
    
    return { success: true };
  } catch (error) {
    console.error('Error sending transfer email with attachments:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
};

// Add this function for sending archive emails
const sendArchiveEmail = async (context, recipients, attachments = []) => {
  try {
    const templatePath = path.join(__dirname, '..', 'views', 'archiveEmail.ejs');
    const html = await ejs.renderFile(templatePath, context);

    const mailOptions = {
      from: process.env.SMTP_FROM_EMAIL || 'no-reply@agapayalert.com',
      to: recipients.join(', '),
      subject: `AgapayAlert - Resolved Reports Archive - ${context.totalReports} Reports`,
      html: html,
      attachments: attachments
    };

    await transporter.sendMail(mailOptions);
    console.log('Archive email sent successfully');
    
    return { success: true };
  } catch (error) {
    console.error('Error sending archive email:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
};

// utils/sendEmail.js
// Add this function for sending archive emails with embedded images
const sendArchiveEmailWithImages = async (context, recipients, attachments = []) => {
  try {
    const templatePath = path.join(__dirname, '..', 'views', 'archiveEmailWithImages.ejs');
    const html = await ejs.renderFile(templatePath, context);

    const mailOptions = {
      from: process.env.SMTP_FROM_EMAIL || 'no-reply@agapayalert.com',
      to: recipients.join(', '),
      subject: `AgapayAlert - Resolved Reports Archive with Images - ${context.totalReports} Reports`,
      html: html,
      attachments: attachments
    };

    await transporter.sendMail(mailOptions);
    console.log('Archive email with embedded images sent successfully');
    
    return { success: true };
  } catch (error) {
    console.error('Error sending archive email with images:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
};

module.exports = { 
  sendEmail, 
  sendTransferEmailWithAttachments, 
  sendArchiveEmail, 
  sendArchiveEmailWithImages 
};