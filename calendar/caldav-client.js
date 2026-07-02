/**
 * CalDAV client for iCloud Calendar
 */

const { DAVClient } = require('tsdav');
const ICAL = require('ical.js');
const config = require('../config');
const { getCredentials } = require('../auth');

let cachedClient = null;

/**
 * Get or create CalDAV client
 */
async function getClient() {
  if (cachedClient) {
    return cachedClient;
  }

  const creds = getCredentials();

  const client = new DAVClient({
    serverUrl: config.CALDAV.SERVER_URL,
    credentials: {
      username: creds.email,
      password: creds.password
    },
    authMethod: 'Basic',
    defaultAccountType: 'caldav'
  });

  try {
    await client.login();
    cachedClient = client;
    return client;
  } catch (error) {
    if (error.message && (error.message.indexOf('401') !== -1 || error.message.indexOf('auth') !== -1)) {
      throw new Error('UNAUTHORIZED');
    }
    throw error;
  }
}

/**
 * Clear cached client (for re-auth)
 */
function clearClient() {
  cachedClient = null;
}

/**
 * Get all calendars
 */
async function getCalendars() {
  const client = await getClient();
  const calendars = await client.fetchCalendars();
  return calendars.map(function(cal) {
    return {
      url: cal.url,
      displayName: cal.displayName || 'Unnamed Calendar',
      ctag: cal.ctag,
      syncToken: cal.syncToken
    };
  });
}

/**
 * Parse iCalendar event to simple object
 */
function parseEvent(icalData, url) {
  try {
    const jcalData = ICAL.parse(icalData);
    const comp = new ICAL.Component(jcalData);
    const vevent = comp.getFirstSubcomponent('vevent');

    if (!vevent) return null;

    const event = new ICAL.Event(vevent);

    return {
      url: url,
      uid: event.uid,
      summary: event.summary || '(No title)',
      description: event.description || '',
      location: event.location || '',
      start: event.startDate ? event.startDate.toJSDate() : null,
      end: event.endDate ? event.endDate.toJSDate() : null,
      isAllDay: event.startDate ? event.startDate.isDate : false,
      organizer: vevent.getFirstPropertyValue('organizer'),
      attendees: vevent.getAllProperties('attendee').map(function(a) { return a.getFirstValue(); }),
      status: event.status,
      created: vevent.getFirstPropertyValue('created') ? vevent.getFirstPropertyValue('created').toJSDate() : null,
      lastModified: vevent.getFirstPropertyValue('last-modified') ? vevent.getFirstPropertyValue('last-modified').toJSDate() : null
    };
  } catch (error) {
    console.error('Error parsing event:', error.message);
    return null;
  }
}

/**
 * List events from all calendars
 */
async function listEvents(count, daysAhead) {
  if (count === undefined) count = 25;
  if (daysAhead === undefined) daysAhead = 30;
  
  const client = await getClient();
  const calendars = await client.fetchCalendars();

  const now = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + daysAhead);

  const allEvents = [];

  for (let i = 0; i < calendars.length; i++) {
    const calendar = calendars[i];
    try {
      const calendarObjects = await client.fetchCalendarObjects({
        calendar: calendar,
        timeRange: {
          start: now.toISOString(),
          end: endDate.toISOString()
        }
      });

      for (let j = 0; j < calendarObjects.length; j++) {
        const obj = calendarObjects[j];
        const event = parseEvent(obj.data, obj.url);
        if (event) {
          event.calendarName = calendar.displayName || 'Calendar';
          allEvents.push(event);
        }
      }
    } catch (error) {
      console.error('Error fetching from calendar ' + calendar.displayName + ':', error.message);
    }
  }

  // Sort by start date
  allEvents.sort(function(a, b) { return (a.start || 0) - (b.start || 0); });

  return allEvents.slice(0, count);
}

/**
 * Create a new event
 */
async function createEvent(params) {
  const summary = params.summary;
  const start = params.start;
  const end = params.end;
  const description = params.description;
  const location = params.location;
  const calendarUrl = params.calendarUrl;

  const client = await getClient();

  // Get calendars if URL not provided
  let targetCalendar;
  const calendars = await client.fetchCalendars();
  if (calendarUrl) {
    for (let i = 0; i < calendars.length; i++) {
      if (calendars[i].url === calendarUrl) {
        targetCalendar = calendars[i];
        break;
      }
    }
  }

  if (!targetCalendar) {
    targetCalendar = calendars[0]; // Use first calendar
  }

  if (!targetCalendar) {
    throw new Error('No calendar found');
  }

  // Create iCalendar data
  const uid = Date.now() + '-' + Math.random().toString(36).substr(2, 9) + '@icloud-mcp';

  const startDate = new Date(start);
  const endDate = new Date(end);

  let icalData = 'BEGIN:VCALENDAR\n' +
    'VERSION:2.0\n' +
    'PRODID:-//iCloud MCP//EN\n' +
    'BEGIN:VEVENT\n' +
    'UID:' + uid + '\n' +
    'DTSTAMP:' + formatICalDate(new Date()) + '\n' +
    'DTSTART:' + formatICalDate(startDate) + '\n' +
    'DTEND:' + formatICalDate(endDate) + '\n' +
    'SUMMARY:' + escapeICalText(summary);
    
  if (description) icalData += '\nDESCRIPTION:' + escapeICalText(description);
  if (location) icalData += '\nLOCATION:' + escapeICalText(location);
  
  icalData += '\nEND:VEVENT\nEND:VCALENDAR';

  const result = await client.createCalendarObject({
    calendar: targetCalendar,
    filename: uid + '.ics',
    iCalString: icalData
  });

  return {
    success: true,
    uid: uid,
    url: result ? result.url : null,
    calendar: targetCalendar.displayName
  };
}

/**
 * Delete an event
 */
async function deleteEvent(eventUrl) {
  const client = await getClient();

  await client.deleteCalendarObject({
    calendarObject: {
      url: eventUrl,
      etag: '' // Will be fetched
    }
  });

  return { success: true };
}

/**
 * Format date for iCalendar
 */
function formatICalDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Escape text for iCalendar
 */
function escapeICalText(text) {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

module.exports = {
  getClient: getClient,
  clearClient: clearClient,
  getCalendars: getCalendars,
  listEvents: listEvents,
  createEvent: createEvent,
  deleteEvent: deleteEvent,
  parseEvent: parseEvent
};
