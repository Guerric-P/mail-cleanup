import readline from 'readline';
import { getTopLargestEmails } from './largest-emails.ts';
import { deleteOldEmails } from './delete-old-emails.ts';
import { extractUnsubscribeLinks } from './extract-unsubscribe.ts';
import { getMailboxSize, checkMailboxSizes } from './statistics.ts';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(prompt: string): Promise<string> {
    return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
            resolve(answer);
        });
    });
}

async function showMenu() {
    console.clear();
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║        Mail Cleanup - Main Menu         ║');
    console.log('╚════════════════════════════════════════╝\n');

    console.log('1. Check all mailbox sizes');
    console.log('2. Get mailbox size by name');
    console.log('3. List largest emails');
    console.log('4. Delete old emails');
    console.log('5. Extract unsubscribe links');
    console.log('6. Exit\n');

    const choice = await question('Select an option (1-6): ');
    return choice;
}

async function handleCheckAllMailboxes() {
    try {
        console.log('\n📊 Checking all mailbox sizes...\n');
        await checkMailboxSizes();
        await question('\nPress Enter to continue...');
    } catch (error) {
        console.error('❌ Error:', error instanceof Error ? error.message : String(error));
        await question('\nPress Enter to continue...');
    }
}

async function handleGetMailboxSize() {
    try {
        const mailboxName = await question('\nEnter mailbox name (e.g., INBOX): ');
        console.log(`\n📊 Getting size for ${mailboxName}...\n`);
        await getMailboxSize(mailboxName, true);
        await question('\nPress Enter to continue...');
    } catch (error) {
        console.error('❌ Error:', error instanceof Error ? error.message : String(error));
        await question('\nPress Enter to continue...');
    }
}

async function handleListLargestEmails() {
    try {
        const mailboxName = await question('\nEnter mailbox name (e.g., INBOX): ');
        const limitStr = await question('How many emails to list? (default 10): ');
        const limit = limitStr ? parseInt(limitStr) : 10;

        console.log(`\n📧 Getting top ${limit} largest emails from ${mailboxName}...\n`);
        await getTopLargestEmails(mailboxName, limit);
        await question('\nPress Enter to continue...');
    } catch (error) {
        console.error('❌ Error:', error instanceof Error ? error.message : String(error));
        await question('\nPress Enter to continue...');
    }
}

async function handleExtractUnsubscribe() {
    try {
        const mailboxName = await question('\nEnter mailbox name (e.g., INBOX): ');
        const outputPath = await question('Output CSV path (default unsubscribe_links.csv): ');
        const out = outputPath ? outputPath.trim() : 'unsubscribe_links.csv';

        console.log(`\n🔍 Extracting unsubscribe links from ${mailboxName} to ${out}...\n`);
        const rows = await extractUnsubscribeLinks(mailboxName, out);
        console.log(`\nExtracted ${rows.length} links (saved to ${out}).`);
        await question('\nPress Enter to continue...');
    } catch (error) {
        console.error('❌ Error:', error instanceof Error ? error.message : String(error));
        await question('\nPress Enter to continue...');
    }
}

async function handleDeleteOldEmails() {
    try {
        const confirm = await question(
            '\n⚠️  Warning: This will delete old emails. Continue? (yes/no): '
        );
        
        if (confirm.toLowerCase() !== 'yes') {
            console.log('Cancelled.');
            await question('\nPress Enter to continue...');
            return;
        }

        console.log('\n🗑️  Deleting old emails...\n');
        await deleteOldEmails();
        await question('\nPress Enter to continue...');
    } catch (error) {
        console.error('❌ Error:', error instanceof Error ? error.message : String(error));
        await question('\nPress Enter to continue...');
    }
}

async function main() {
    let running = true;

    while (running) {
        const choice = await showMenu();

        switch (choice) {
            case '1':
                await handleCheckAllMailboxes();
                break;
            case '2':
                await handleGetMailboxSize();
                break;
            case '3':
                await handleListLargestEmails();
                break;
            case '4':
                await handleDeleteOldEmails();
                break;
            case '5':
                await handleExtractUnsubscribe();
                break;
            case '6':
                console.log('\n👋 Goodbye!\n');
                running = false;
                break;
            default:
                console.log('\n❌ Invalid option. Please select 1-6.');
                await question('Press Enter to continue...');
        }
    }

    rl.close();
}

main();
