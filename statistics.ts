import { connect } from 'imap-simple';
import { config } from './config.ts';
import moment from 'moment';


async function getMailboxSize(mailboxName: string, fetchSize = false) {

    const connection = await connect(config);

    const boxes = await connection.getBoxes();
    console.log('Boxes:', Object.keys(boxes));

    await connection.openBox(mailboxName);

    console.log(`Opened box ${mailboxName}`);

    let fromDate = moment('2015-01-01T00:00:00.000Z');
    let toDate = moment('2016-01-01T00:00:00.000Z');
    let flags = [];
    let size = 0;
    let numberOfEmails = 0;

    while (fromDate.isBefore(moment())) {
        console.log(`Searching for emails between ${fromDate.format()} and ${toDate.format()}`);

        const fetchOptions = { bodies: [`HEADER.FIELDS (FROM TO SUBJECT DATE${fetchSize ? ' BODY SIZE' : ''})`], struct: true };

        const searchCriteria = [
            ['BEFORE', toDate.toDate()],
            ['SINCE', fromDate.toDate()],
        ];

        const messages = await connection.search(searchCriteria, fetchOptions);

        const batchSize = messages
            .flatMap(x => [...x.attributes.struct.flatMap(y => y instanceof Array ? y.map(z => z.size) : y.size), ...x.parts.map(y => y.size)])
            .reduce((acc, x) => acc + (x || 0), 0);

        size += batchSize;

        console.log(`Batch size of year ${fromDate.year()}: ${batchSize / 1000000} MB`);

        numberOfEmails += messages.length;

        flags.push(...messages.reduce((acc, x) => [...acc, ...x.attributes.flags], []));

        fromDate = fromDate.add(1, 'year');
        toDate = toDate.add(1, 'year');

        if (messages.length === 0) {
            console.log('No emails found');
            continue;
        }

        console.log(`Found ${messages.length} emails`);
    }

    const deduplicatedFlags = [...new Set(flags)];

    console.log(`Flags: ${deduplicatedFlags}`);
    console.log(`Size: ${size} bytes`);
    console.log(`Number of emails: ${numberOfEmails}`);

    connection.end();
}

async function checkMailboxSizes() {
    await getMailboxSize('INBOX', true);
    await getMailboxSize('INBOX/OUTBOX', true);
}

export { getMailboxSize, checkMailboxSizes };

// Uncomment to run:
// checkMailboxSizes();