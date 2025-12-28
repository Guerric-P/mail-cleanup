import { connect } from 'imap-simple';
import { config } from './config.ts';
import fs from 'fs';
import { XMLParser } from 'fast-xml-parser';

interface UnsubscribeInfo {
    unsubscribe: string | null;
    foundIn: 'header' | 'body' | 'none';
}

function escapeCsv(value: string | null) {
    if (value == null) return '""';
    return '"' + String(value).replace(/"/g, '""') + '"';
}

function findUnsubscribeInHeader(headerText: any): UnsubscribeInfo[] {
    if (!headerText) return [];

    // Normalize whitespace and unfold folded header lines per RFC (replace CRLF + WSP)
    const text = String(headerText).replace(/\r?\n[ \t]+/g, ' ').trim();

    // Collect URIs enclosed in angle brackets first (RFC form): <mailto:...>, <http://...>
    const uris: string[] = [];
    const angleRegex = /<([^>]+)>/g;
    let m;
    while ((m = angleRegex.exec(text)) !== null) {
        const uri = m[1].trim();
        if (uri) uris.push(uri);
    }

    // If no angle-bracketed URIs, try to parse comma-separated tokens
    if (uris.length === 0) {
        // Split on commas (headers contain a comma-separated list of URIs)
        const parts = text.split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/);
        for (let p of parts) {
            p = p.trim().replace(/^"|"$/g, '');
            // try to extract an http(s) or mailto URI from the token
            const urlMatch = p.match(/(https?:\/\/[^\s"'<>]+)/i);
            if (urlMatch) uris.push(urlMatch[1]);
            else {
                const mailtoMatch = p.match(/mailto:[^\s"'<>]+/i);
                if (mailtoMatch) uris.push(mailtoMatch[0]);
            }
        }
    }

    // Deduplicate while preserving order
    const unique = [...new Set(uris)];
    if (unique.length === 0) return [];

    const results: UnsubscribeInfo[] = [];
    const http = unique.find(u => /^https?:\/\//i.test(u));
    if (http) results.push({ unsubscribe: http, foundIn: 'header' });
    const mailto = unique.find(u => /^mailto:/i.test(u));
    if (mailto) results.push({ unsubscribe: mailto, foundIn: 'header' });

    // Fallback: return the first URI
    if (results.length === 0 && unique.length > 0) {
        results.push({ unsubscribe: unique[0], foundIn: 'header' });
    }

    return results;
}

function findUnsubscribeInBody(bodyText: string): UnsubscribeInfo {
    if (!bodyText) return { unsubscribe: null, foundIn: 'none' };

    // Parse the multipart using the form-data library, not regexes

    // Try to detect HTML; if no '<a' present, give up quickly
    if (!/<a\s+/i.test(bodyText)) return { unsubscribe: null, foundIn: 'none' };

    bodyText = extractHtmlFromMime(bodyText) || bodyText;

    // Wrap in a root to help the XML parser with fragments
    const wrapped = `<root>${bodyText}</root>`;

    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        allowBooleanAttributes: true,
        parseTagValue: false,
    });

    let parsed: any;
    try {
        parsed = parser.parse(wrapped);
    } catch (e) {
        return { unsubscribe: null, foundIn: 'none' };
    }

    const candidates: string[] = [];
    const unsubscribeRegexForEnglishAndFrench = /unsubscribe|d[ée]sabonner|d[ée]sinscrire|opt[- ]?out/i;

    // Recursive walk to find all <a> nodes
    function walk(node: any) {
        if (!node || typeof node !== 'object') return;
        for (const key of Object.keys(node)) {
            const val = node[key];
            if (key.toLowerCase() === 'a') {
                // 'a' node can be an array or object
                const items = Array.isArray(val) ? val : [val];
                for (const item of items) {
                    const href = item['@_href'] || item['@_HREF'] || item['@_src'] || null;
                    const rel = item['@_rel'] || '';
                    const aria = item['@_aria-label'] || '';
                    const text = (typeof item === 'object' && ('#text' in item)) ? item['#text'] : '';

                    const matchScore = () => {
                        const combined = `${rel} ${aria} ${text}`.toLowerCase();
                        if (unsubscribeRegexForEnglishAndFrench.test(combined)) return true;
                        if (href && unsubscribeRegexForEnglishAndFrench.test(String(href))) return true;
                        return false;
                    };

                    if (href && matchScore()) candidates.push(String(href).trim());
                    else if (href && /mailto:/i.test(String(href)) && unsubscribeRegexForEnglishAndFrench.test(String(href))) candidates.push(String(href).trim());
                    else if (href && unsubscribeRegexForEnglishAndFrench.test(String(href))) candidates.push(String(href).trim());
                }
            } else if (typeof val === 'object') {
                walk(val);
            }
        }
    }

    walk(parsed);

    // Deduplicate preserving order
    const unique = [...new Set(candidates)];
    if (unique.length === 0) return { unsubscribe: null, foundIn: 'none' };

    // Prefer http(s) over mailto
    const http = unique.find(u => /^https?:\/\//i.test(u));
    if (http) return { unsubscribe: http, foundIn: 'body' };
    const mailto = unique.find(u => /^mailto:/i.test(u));
    if (mailto) return { unsubscribe: mailto, foundIn: 'body' };

    return { unsubscribe: unique[0], foundIn: 'body' };
}

async function extractUnsubscribeLinks(mailboxName = 'INBOX', outputPath = 'unsubscribe_links.csv') {
    const connection = await connect(config);
    await connection.openBox(mailboxName);

    console.log(`Searching for unread emails in ${mailboxName}...`);

    // Fetch all UNSEEN messages with needed fields in a single request
    const searchCriteria = [['UNSEEN']];
    const fetchOptions = { bodies: ['HEADER.FIELDS (FROM SUBJECT DATE LIST-UNSUBSCRIBE)', 'TEXT'], struct: true };
    const messages = await connection.search(searchCriteria, fetchOptions);

    if (!messages || messages.length === 0) {
        console.log('No unread emails found.');
        connection.end();
        return [];
    }

    console.log(`Found ${messages.length} unread emails. Processing...`);

    const rows = [];
    for (const message of messages) {
        // Get header and body parts
        const headerPart = message.parts.find(p => p.which && p.which.toUpperCase().startsWith('HEADER'));
        const bodyPart = message.parts.find(p => p.which && p.which === 'TEXT');
        const bodyText = bodyPart ? bodyPart.body : '';

        // Extract subject, date, from and list-unsubscribe from parsed header (imap-simple format)
        const date = headerPart?.body?.date?.[0] || '';
        const subject = headerPart?.body?.subject?.[0] || 'No subject';
        const from = headerPart?.body?.from?.[0] || '';
        const listUnsubscribe = headerPart?.body['list-unsubscribe']?.[0] || '';

        // Try to find unsubscribe link in List-Unsubscribe header, then in body, the select oen result bby prioritizing like this
        // 1. HTTPS in header
        // 2. HTTPS in body
        // 3. mailto in header
        let unsubscribeInfo: UnsubscribeInfo[] = [];
        if (listUnsubscribe) {
            unsubscribeInfo = findUnsubscribeInHeader(listUnsubscribe);
        }
        if (unsubscribeInfo.length === 0) {
            const bodyUnsub = findUnsubscribeInBody(bodyText);
            if (bodyUnsub.unsubscribe) {
                unsubscribeInfo.push(bodyUnsub);
            }
        }
        
        unsubscribeInfo.sort((a, b) => {
            const score = (info: UnsubscribeInfo) => {
                if (/^https?:\/\//i.test(info.unsubscribe || '')) return 3;
                if (/^mailto:/i.test(info.unsubscribe || '')) return 2;
                if (info.unsubscribe) return 1;
                return 0;
            };
            return score(b) - score(a);
        });

        const { unsubscribe, foundIn } = unsubscribeInfo.length > 0 ? unsubscribeInfo[0] : { unsubscribe: null, foundIn: 'none' };

        rows.push({ subject, date, from, unsubscribe, foundIn });
    }

    connection.end();

    // write CSV
    const header = ['Subject', 'Date', 'From', 'UnsubscribeLink', 'FoundIn'];
    const csvLines = [header.map(escapeCsv).join(',')];
    for (const r of rows) {
        csvLines.push([
            escapeCsv(r.subject),
            escapeCsv(r.date),
            escapeCsv(r.from || ''),
            escapeCsv(r.unsubscribe || ''),
            escapeCsv(r.foundIn || 'none')
        ].join(','));
    }

    fs.writeFileSync(outputPath, csvLines.join('\n'), { encoding: 'utf8' });
    console.log(`Wrote ${rows.length} rows to ${outputPath}`);

    return rows;
}

function extractHtmlFromMime(rawEmail) {
  // 1. Récupérer la boundary dynamique
  const boundaryMatch = rawEmail.match(/--([a-f0-9]{40,})/i);
  if (!boundaryMatch) return null; // Pas de boundary trouvé
  const boundary = boundaryMatch[1];

  // 2. Séparer les parties du message
  const parts = rawEmail.split(`--${boundary}`);
  
  // 3. Chercher la partie HTML
  for (const part of parts) {
    if (/Content-Type:\s*text\/html/i.test(part)) {
      // Retirer les headers
      const htmlMatch = part.split(/\r?\n\r?\n/).slice(1).join("\n");
      
      // 4. Décoder le quoted-printable
      return decodeQuotedPrintable(htmlMatch.trim());
    }
  }

  return null; // Pas de HTML trouvé
}

// Fonction basique de décodage quoted-printable
function decodeQuotedPrintable(str) {
  return str
    .replace(/=(\r?\n)/g, '')        // supprime les retours à la ligne "=\n"
    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export { extractUnsubscribeLinks };
