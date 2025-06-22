require('dotenv').config();
const { writeFileSync, readFileSync, existsSync } = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const jsdom = require('jsdom');
const nodeFetch = require('node-fetch');
const axios = require('axios');

// const { getZipCode, getNeighbourhoodData, convertResidentsToPercentage} = require('./utils/utils');

const WIDTH = 1920;
const HEIGHT = 1080;

// Read from db.json or initialize with an empty Set
const dbFile = 'db.json';
let sentListingIds = new Set();
if (existsSync(dbFile)) {
    try {
        const data = JSON.parse(readFileSync(dbFile, 'utf-8'));
        sentListingIds = new Set(data);
    } catch (err) {
        console.error('Failed to read db.json:', err);
    }
}

// const data = readFileSync('db.json', { encoding:'utf8', flag: 'r' });
const pastResults = new Set();
const newResults = new Set();
const houses = [];

// const { CHAT_ID, BOT_API } = process.env;
const CHAT_ID = process.env.CHAT_ID || '-1002855493181';
const BOT_API = process.env.BOT_API || '8102231191:AAEefpXT6BGlAysx1-xr8FCnURlrCsRFrBk';

const baseUrl = 'https://www.marktplaats.nl/l/computers-en-software/p/' ;
const queryString = '/#PriceCentsTo:0|sortBy:SORT_INDEX|sortOrder:DECREASING|distanceMeters:25000|postcode:1362JJ';
const urls = Array.from({ length: 1 }, (_, i) => `${baseUrl}${i + 1}${queryString}`);
console.log(urls);

async function fetchListings() {
    try {
        const apiUrl = 'https://www.marktplaats.nl/lrp/api/search?attributeRanges[]=PriceCents%3Anull%3A0&attributesById[]=0&distanceMeters=25000&l1CategoryId=322&limit=30&offset=0&postcode=1362JJ&sortBy=SORT_INDEX&sortOrder=DECREASING&viewOptions=list-view';
        const response = await axios.get(apiUrl);
        const data = response.data;
        const listings = data.listings || [];

        const newIds = [];

        for (const listing of listings) {
            const listingId = listing.itemId;
            if (sentListingIds.has(listingId)) {
                console.log(`Skipping already sent listing: ${listingId}`);
                continue;
            }

            const price = listing.priceInfo?.priceCents ?? 'No Price';
            let text = `*New computer!* \n\n*${listing.title || 'No Title'}*\n💸 Price: ${price}\n🔗 URL: https://www.marktplaats.nl${listing.vipUrl || '#No URL'}\n📦 Type: ${listing.priceInfo?.priceType || 'No Price Type'}`;

            console.log(`Sending ${listingId} to Telegram`);

            await nodeFetch(`https://api.telegram.org/bot${BOT_API}/sendMessage`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text,
                    chat_id: CHAT_ID,
                    parse_mode: 'Markdown',
                }),
            })
                .then(res => res.json())
                .then(json => {
                    if (!json.ok) {
                        console.error('Telegram API error:', json);
                    }
                })
                .catch(err => {
                    console.error('Telegram fetch error:', err);
                });

            console.log(`Sent ${listingId}`);
            sentListingIds.add(listingId);
            newIds.push(listingId);
        }

        // Update db.json
        writeFileSync(dbFile, JSON.stringify(Array.from(sentListingIds), null, 2));
        console.log(`Updated db.json with ${newIds.length} new listings`);

    } catch (error) {
        console.error('Error fetching data:', error);
    }
}

const runTask = async () => {
    for (const url of urls) {
        await runPuppeteer(url);
    }

    console.log('newResults:', newResults);
};

const reprocessFundaDb = async () => {
    const newId = new Set();
    for (const pastUrl of pastResults) {
        newId.add(fundaId(pastUrl));
    }
    console.log(`newId size: ${Array.from([...newId])}`);
    writeFileSync('db.json', JSON.stringify(Array.from([...newId])));
};

const runPuppeteer = async (url) => {
    console.log('opening headless browser');
    const browser = await puppeteer.launch({
        headless: true,
        args: [`--window-size=${WIDTH},${HEIGHT}`, `--headless`],
        defaultViewport: {
            width: WIDTH,
            height: HEIGHT,
        },
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36');
    await page.setJavaScriptEnabled(false);

    console.log('going to marktplaats');

    await page.evaluate(() => {
        return new Promise((resolve) => {
            const observer = new MutationObserver((mutations) => {
                if (mutations.some(mutation => mutation.type === 'childList')) {
                    resolve();
                    observer.disconnect();
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        });
    });

    const htmlString = await page.content();
    const dom = new jsdom.JSDOM(htmlString);

    console.log('parsing marktplaats data');
    const headerTexts = [...dom.window.document.querySelectorAll('li.hz-Listing.hz-Listing--list-item h3')].map(h3 => h3.textContent.trim());
    console.log(headerTexts);

    console.log('closing browser');
    await browser.close();
};

const fundaId = (urlPath) => {
    return urlPath.replace('https://www.funda.nl/en', '').replace('https://www.funda.nl', '');
};

const buildMessageData = async (price, subtitleText, newResultsSet, path, id) => {
    let extraDetails = price ? { "price": price } : {};
    extraDetails = { ...extraDetails, "subTitle": subtitleText };

    newResultsSet.add(id ? id : path);
    houses.push({
        ...extraDetails,
        path,
    });
};

// --- Main Execution ---
fetchListings();
// runTask();
// if (CHAT_ID && BOT_API) {
//     runTask();
// } else {
//     console.log('Missing Telegram API keys!');
// }
