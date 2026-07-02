/**
 * CardDAV client for iCloud Contacts
 */

const { DAVClient } = require('tsdav');
const config = require('../config');
const { getCredentials } = require('../auth');

let cachedClient = null;

/**
 * Get or create CardDAV client
 */
async function getClient() {
  if (cachedClient) {
    return cachedClient;
  }

  const creds = getCredentials();

  const client = new DAVClient({
    serverUrl: config.CARDDAV.SERVER_URL,
    credentials: {
      username: creds.email,
      password: creds.password
    },
    authMethod: 'Basic',
    defaultAccountType: 'carddav'
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
 * Clear cached client
 */
function clearClient() {
  cachedClient = null;
}

/**
 * Parse vCard to simple object
 */
function parseVCard(vcardData, url) {
  try {
    const contact = {
      url: url,
      uid: '',
      displayName: '',
      firstName: '',
      lastName: '',
      emails: [],
      phones: [],
      organization: '',
      title: '',
      notes: ''
    };

    const lines = vcardData.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;

      const key = line.substring(0, colonIndex).toUpperCase();
      const value = line.substring(colonIndex + 1);

      // Handle property parameters (like TYPE=WORK)
      const keyParts = key.split(';');
      const mainKey = keyParts[0];

      switch (mainKey) {
        case 'UID':
          contact.uid = value;
          break;
        case 'FN':
          contact.displayName = decodeVCardValue(value);
          break;
        case 'N':
          const nameParts = value.split(';');
          contact.lastName = decodeVCardValue(nameParts[0] || '');
          contact.firstName = decodeVCardValue(nameParts[1] || '');
          break;
        case 'EMAIL':
          const emailType = extractType(keyParts) || 'other';
          contact.emails.push({ type: emailType, value: decodeVCardValue(value) });
          break;
        case 'TEL':
          const phoneType = extractType(keyParts) || 'other';
          contact.phones.push({ type: phoneType, value: decodeVCardValue(value) });
          break;
        case 'ORG':
          contact.organization = decodeVCardValue(value.split(';')[0]);
          break;
        case 'TITLE':
          contact.title = decodeVCardValue(value);
          break;
        case 'NOTE':
          contact.notes = decodeVCardValue(value);
          break;
      }
    }

    // Use first/last name if no display name
    if (!contact.displayName && (contact.firstName || contact.lastName)) {
      contact.displayName = ( (contact.firstName || '') + ' ' + (contact.lastName || '') ).trim();
    }

    return contact;
  } catch (error) {
    console.error('Error parsing vCard:', error.message);
    return null;
  }
}

/**
 * Extract TYPE parameter from vCard property
 */
function extractType(keyParts) {
  for (let i = 0; i < keyParts.length; i++) {
    const part = keyParts[i];
    if (part.indexOf('TYPE=') === 0) {
      return part.substring(5).toLowerCase();
    }
  }
  return null;
}

/**
 * Decode vCard escaped value
 */
function decodeVCardValue(value) {
  if (!value) return '';
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/**
 * Encode value for vCard
 */
function encodeVCardValue(value) {
  if (!value) return '';
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Get all address books
 */
async function getAddressBooks() {
  const client = await getClient();
  const addressBooks = await client.fetchAddressBooks();
  return addressBooks.map(function(ab) {
    return {
      url: ab.url,
      displayName: ab.displayName || 'Contacts'
    };
  });
}

/**
 * List contacts
 */
async function listContacts(count) {
  if (count === undefined) count = 25;
  const client = await getClient();
  const addressBooks = await client.fetchAddressBooks();

  const allContacts = [];

  for (let i = 0; i < addressBooks.length; i++) {
    const addressBook = addressBooks[i];
    try {
      const vcards = await client.fetchVCards({ addressBook: addressBook });

      for (let j = 0; j < vcards.length; j++) {
        const vcard = vcards[j];
        const contact = parseVCard(vcard.data, vcard.url);
        if (contact && contact.displayName) {
          allContacts.push(contact);
        }
      }
    } catch (error) {
      console.error('Error fetching from address book:', error.message);
    }
  }

  // Sort by display name
  allContacts.sort(function(a, b) { return a.displayName.localeCompare(b.displayName); });

  return allContacts.slice(0, count);
}

/**
 * Search contacts
 */
async function searchContacts(query, count) {
  if (count === undefined) count = 25;
  const allContacts = await listContacts(count * 2);
  const lowerQuery = query.toLowerCase();

  const matches = allContacts.filter(function(contact) {
    const emailVals = contact.emails.map(function(e) { return e.value; });
    const phoneVals = contact.phones.map(function(p) { return p.value; });
    
    const searchText = [
      contact.displayName,
      contact.firstName,
      contact.lastName,
      contact.organization
    ].concat(emailVals).concat(phoneVals).join(' ').toLowerCase();

    return searchText.indexOf(lowerQuery) !== -1;
  });

  return matches.slice(0, count);
}

/**
 * Get contact by URL
 */
async function getContact(contactUrl) {
  const client = await getClient();

  const vcard = await client.fetchVCards({
    addressBook: { url: contactUrl.substring(0, contactUrl.lastIndexOf('/') + 1) },
    objectUrls: [contactUrl]
  });

  if (vcard && vcard[0]) {
    return parseVCard(vcard[0].data, vcard[0].url);
  }

  throw new Error('Contact not found');
}

/**
 * Create a new contact
 */
async function createContact(params) {
  const displayName = params.displayName;
  const firstName = params.firstName;
  const lastName = params.lastName;
  const email = params.email;
  const phone = params.phone;
  const organization = params.organization;
  const title = params.title;
  const notes = params.notes;

  const client = await getClient();
  const addressBooks = await client.fetchAddressBooks();

  if (addressBooks.length === 0) {
    throw new Error('No address book found');
  }

  const addressBook = addressBooks[0];
  const uid = Date.now() + '-' + Math.random().toString(36).substr(2, 9);

  const display = displayName || ( (firstName || '') + ' ' + (lastName || '') ).trim();

  let vcard = 'BEGIN:VCARD\n' +
    'VERSION:3.0\n' +
    'UID:' + uid + '\n' +
    'FN:' + encodeVCardValue(display) + '\n' +
    'N:' + encodeVCardValue(lastName || '') + ';' + encodeVCardValue(firstName || '') + ';;;';

  if (email) {
    vcard += '\nEMAIL;TYPE=INTERNET:' + encodeVCardValue(email);
  }
  if (phone) {
    vcard += '\nTEL;TYPE=CELL:' + encodeVCardValue(phone);
  }
  if (organization) {
    vcard += '\nORG:' + encodeVCardValue(organization);
  }
  if (title) {
    vcard += '\nTITLE:' + encodeVCardValue(title);
  }
  if (notes) {
    vcard += '\nNOTE:' + encodeVCardValue(notes);
  }

  vcard += '\nEND:VCARD';

  const result = await client.createVCard({
    addressBook: addressBook,
    filename: uid + '.vcf',
    vCardString: vcard
  });

  return {
    success: true,
    uid: uid,
    url: result ? result.url : null
  };
}

/**
 * Delete a contact
 */
async function deleteContact(contactUrl) {
  const client = await getClient();

  await client.deleteVCard({
    vCard: {
      url: contactUrl,
      etag: ''
    }
  });

  return { success: true };
}

module.exports = {
  getClient: getClient,
  clearClient: clearClient,
  getAddressBooks: getAddressBooks,
  listContacts: listContacts,
  searchContacts: searchContacts,
  getContact: getContact,
  createContact: createContact,
  deleteContact: deleteContact,
  parseVCard: parseVCard
};
