/**
 * Date formatting utilities
 */

const config = require('../config');

/**
 * Format date for display (Spanish locale by default)
 */
function formatDate(date, options) {
  if (options === undefined) options = {};
  const d = date instanceof Date ? date : new Date(date);

  const defaultOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: config.DEFAULTS.TIMEZONE
  };

  const finalOptions = {};
  for (let key in defaultOptions) finalOptions[key] = defaultOptions[key];
  for (let key in options) finalOptions[key] = options[key];

  return d.toLocaleString(config.DEFAULTS.DATE_FORMAT, finalOptions);
}

/**
 * Format date for iCalendar (YYYYMMDDTHHMMSS format)
 */
function formatICalDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Parse ISO date string
 */
function parseDate(dateStr) {
  return new Date(dateStr);
}

/**
 * Get date range for calendar queries
 */
function getDateRange(daysAhead) {
  if (daysAhead === undefined) daysAhead = 30;
  const start = new Date();
  const end = new Date();
  end.setDate(end.getDate() + daysAhead);

  return { start: start, end: end };
}

/**
 * Format relative date (today, yesterday, etc.)
 */
function formatRelative(date) {
  const d = date instanceof Date ? date : new Date(date);
  const now = new Date();
  const diff = Math.floor((now - d) / (1000 * 60 * 60 * 24));

  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  if (diff < 7) return 'Hace ' + diff + ' días';

  return formatDate(d, { hour: undefined, minute: undefined });
}

module.exports = {
  formatDate: formatDate,
  formatICalDate: formatICalDate,
  parseDate: parseDate,
  getDateRange: getDateRange,
  formatRelative: formatRelative
};
