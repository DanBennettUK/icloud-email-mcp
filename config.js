/**
 * iCloud MCP Configuration
 * Centralized configuration for all iCloud services
 */

require('dotenv').config();

const useLocalModeRaw = process.env.USE_LOCAL_MODE ?? process.env.USELOCALMODE;
// Auto-detect Vercel or non-macOS environment to disable local mode
const isVercel = !!process.env.VERCEL;
const isMacOS = process.platform === 'darwin';

module.exports = {
  // Mode flags
  USE_TEST_MODE: process.env.USE_TEST_MODE === 'true',
  // Disable local mode if on Vercel or not on macOS, unless explicitly forced to 'true'
  USE_LOCAL_MODE: useLocalModeRaw === 'true' ? true : (useLocalModeRaw === 'false' || isVercel || !isMacOS ? false : true),

  // Check if running on macOS (required for local mode)
  IS_MACOS: isMacOS,

  // iCloud credentials
  ICLOUD_EMAIL: process.env.ICLOUD_EMAIL,
  ICLOUD_APP_PASSWORD: process.env.ICLOUD_APP_PASSWORD ?? process.env.ICLOUDAPPPASSWORD,

  // IMAP settings for iCloud Mail
  IMAP: {
    HOST: 'imap.mail.me.com',
    PORT: 993,
    TLS: true,
    AUTH_TIMEOUT: 10000,
    CONN_TIMEOUT: 30000
  },

  // SMTP settings for sending mail
  SMTP: {
    HOST: 'smtp.mail.me.com',
    PORT: 587,
    SECURE: false  // Uses STARTTLS
  },

  // CalDAV settings for Calendar
  CALDAV: {
    SERVER_URL: 'https://caldav.icloud.com',
    // Principal URL will be discovered during auth
    AUTH_METHOD: 'Basic'
  },

  // CardDAV settings for Contacts
  CARDDAV: {
    SERVER_URL: 'https://contacts.icloud.com',
    AUTH_METHOD: 'Basic'
  },

  // Default settings
  DEFAULTS: {
    TIMEZONE: 'Europe/London',
    PAGE_SIZE: 25,
    MAX_RESULTS: 50,
    EMAIL_BODY_MAX_LENGTH: 50000,
    DATE_FORMAT: 'en-GB'
  },

  // Email folder mappings
  EMAIL_FOLDERS: {
    inbox: 'INBOX',
    sent: 'Sent Messages',
    drafts: 'Drafts',
    trash: 'Deleted Messages',
    archive: 'Archive',
    junk: 'Junk'
  }
};
