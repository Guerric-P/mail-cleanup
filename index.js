import { connect } from 'imap-simple';
import moment from 'moment';
import { config } from './config.js';

// Set the date threshold (e.g., delete emails older than 30 days)
const deleteBeforeDate = moment();

async function deleteOldEmails() {
    try {
        const connection = await connect(config);

        await connection.openBox('INBOX');
        
        console.log('Opened inbox, now searching for emails older than:', deleteBeforeDate);

        const searchCriteria = [
            ['BEFORE', deleteBeforeDate],
            ['UNSEEN']
        ];
        const fetchOptions = { bodies: ['HEADER.FIELDS (FROM SUBJECT DATE)'], struct: true };

        const messages = await connection.search(searchCriteria, fetchOptions);

        if (messages.length === 0) {
            console.log('No emails found to delete.');
            connection.end();
            return;
        }

        console.log(`Found ${messages.length} emails to delete.`);

        await connection.deleteMessage(messages.map(x => x.attributes.uid));
        console.log('Old emails deleted successfully.');

        connection.end();
    } catch (error) {
        console.error('Error:', error);
    }
}

deleteOldEmails();
