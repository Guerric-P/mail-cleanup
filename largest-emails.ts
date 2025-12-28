import { connect } from 'imap-simple';
import { config } from './config.ts';

interface EmailInfo {
    subject: string;
    from: string;
    date: string;
    size: number;
    uid: number;
}

async function getTopLargestEmails(mailboxName: string, limit = 10) {
    const connection = await connect(config);

    await connection.openBox(mailboxName);

    console.log(`Searching for largest emails in ${mailboxName}...`);

    // First, search without fetching bodies to get all UIDs
    const searchCriteria = [['ALL']];
    const uids = await connection.search(searchCriteria, { bodies: '' });

    console.log(`Found ${uids.length} emails, fetching details...`);

    // Fetch in batches to avoid "Too long argument" error
    const batchSize = 100;
    const emailsWithSize: EmailInfo[] = [];

    for (let i = 0; i < uids.length; i += batchSize) {
        const batch = uids.slice(i, i + batchSize);
        console.log(`Fetching batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(uids.length / batchSize)}...`);

        const fetchOptions = { 
            bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)'],
            struct: true 
        };

        const messages = await connection.search(
            [['UID', batch.map(m => m.attributes.uid).join(',')]],
            fetchOptions
        );

        messages.forEach(message => {
            const size = message.attributes.struct
                ?.flatMap(struct => struct instanceof Array ? struct.map(s => s.size) : struct.size)
                .reduce((acc, s) => acc + (s || 0), 0);

            const from = message.parts.find(p => p.which.includes('FROM'))?.body || 'Unknown';
            const subject = message.parts.find(p => p.which.includes('SUBJECT'))?.body || 'No subject';
            const date = message.parts.find(p => p.which.includes('DATE'))?.body || 'Unknown';

            emailsWithSize.push({
                subject,
                from,
                date,
                size,
                uid: message.attributes.uid
            });
        });
    }

    // Sort by size descending
    emailsWithSize.sort((a, b) => b.size - a.size);

    // Get top N
    const topEmails = emailsWithSize.slice(0, limit);

    console.log(`\nTop ${limit} largest emails in ${mailboxName}:`);
    console.log('============================================');
    topEmails.forEach((email, index) => {
        console.log(`\n${index + 1}. Size: ${(email.size / 1000000).toFixed(2)} MB`);
        console.log(`   From: ${email.from}`);
        console.log(`   Subject: ${email.subject}`);
        console.log(`   Date: ${email.date}`);
    });

    connection.end();
    return topEmails;
}

// Usage example:
// await getTopLargestEmails('INBOX', 10);

export { getTopLargestEmails };
