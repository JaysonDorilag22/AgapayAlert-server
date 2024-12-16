/**
 * Create mail options for sending emails.
 * @param {string} to - The recipient address.
 * @param {string} subject - The subject of the email.
 * @param {string} template - The path to the EJS template.
 * @param {Object} context - The context to pass to the EJS template.
 * @returns {Object} - The mail options.
 */
const createMailOptions = (to, subject, template, context) => {
    return {
      from: 'no-reply@agapayalert.com',
      to,
      subject,
      template,
      context,
    };
  };
  
  module.exports = createMailOptions;