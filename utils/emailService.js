// utils/emailService.js
const nodemailer = require('nodemailer');

const createTransporter = () => {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
};

/**
 * Sends a high-standard branded TogetherCare OTP email
 */
const sendPasswordResetOtpEmail = async (toEmail, firstName, otp) => {
  const transporter = createTransporter();

  const htmlTemplate = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>TogetherCare Password Reset</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #f4f6f8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;">
          <tr>
            <td align="center" style="padding: 40px 15px;">
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 520px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
                
                <!-- Header -->
                <tr>
                  <td align="center" style="background-color: #1E3A8A; padding: 32px 20px;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: 0.5px;">TogetherCare</h1>
                    <p style="color: #93C5FD; margin: 6px 0 0; font-size: 13px; font-weight: 500;">Connecting Generations, Enriching Lives</p>
                  </td>
                </tr>

                <!-- Content -->
                <tr>
                  <td style="padding: 36px 32px 24px;">
                    <h2 style="color: #111827; font-size: 20px; font-weight: 700; margin: 0 0 12px;">Password Reset Request</h2>
                    <p style="color: #4B5563; font-size: 14px; line-height: 22px; margin: 0 0 24px;">
                      Hello ${firstName || 'Valued User'},<br>
                      We received a request to reset your TogetherCare account password. Please use the 4-digit verification code below to authorize the update:
                    </p>

                    <!-- Code Block -->
                    <div style="background-color: #F0F5FF; border: 1.5px dashed #3B82F6; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
                      <span style="font-family: monospace, Courier; font-size: 36px; font-weight: 800; letter-spacing: 12px; color: #1E40AF; padding-left: 12px;">${otp}</span>
                    </div>

                    <p style="color: #6B7280; font-size: 13px; line-height: 20px; margin: 0 0 16px;">
                      ⏳ This verification code expires in <strong>10 minutes</strong>.
                    </p>
                    <p style="color: #9CA3AF; font-size: 12px; line-height: 18px; margin: 0;">
                      If you did not initiate this request, you can safely ignore this email. Your current password remains secure.
                    </p>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background-color: #F9FAFB; padding: 20px 32px; border-top: 1px solid #E5E7EB; text-align: center;">
                    <p style="color: #9CA3AF; font-size: 12px; margin: 0;">
                      © ${new Date().getFullYear()} TogetherCare Sri Lanka. All rights reserved.<br>
                      Colombo, Sri Lanka
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || '"TogetherCare" <togethercareadmin@gmail.com>',
    to: toEmail,
    subject: `TogetherCare Security: ${otp} is your verification code`,
    html: htmlTemplate,
  });
};

module.exports = { sendPasswordResetOtpEmail };