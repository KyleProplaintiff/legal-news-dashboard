const axios = require('axios');
const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');

const API_KEY = process.env.ANTHROPIC_API_KEY;
const DATA_FILE = path.join(__dirname, 'data', 'articles.json');

if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

function readData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {}
  return { fetches: [] };
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const QUERIES = [
  'legal+tech+AI+startup',
  'law+firm+artificial+intelligence',
  'Harvey+AI+OR+Clio+OR+Legora+legal',
  'legaltech+funding+OR+acquisition',
  'contract+AI+OR+ediscovery+AI',
  'legal+AI+regulation+OR+court',
  'Ironclad+OR+Luminance+OR+Everlaw+OR+Relativity+AI',
];

async function fetchRSS(query) {
  const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      },
      timeout: 15000
    });
    const parsed = await xml2js.parseStringPromise(response.data);
    const items = parsed?.rss?.channel?.[0]?.item || [];
    return items.map(item => ({
      title: item.title?.[0] || '',
      url: item.link?.[0] || '',
      source: item.source?.[0]?._ || item.source?.[0] || 'Unknown',
      pubDate: item.pubDate?.[0] || '',
      summary: item.description?.[0]?.replace(/<[^>]*>/g, '').slice(0, 300) || ''
    }));
  } catch (e) {
    console.log(`RSS fetch failed for "${query}": ${e.message}`);
    return [];
  }
}

function deduplicateArticles(articles) {
  const seen = new Set();
  return articles.filter(a => {
    const key = a.title.toLowerCase().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isRecent(pubDate) {
  if (!pubDate) return true;
  try {
    const pub = new Date(pubDate);
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    return pub > cutoff;
  } catch (e) {
    return true;
  }
}

async function tagArticles(articles) {
  const list = articles.map((a, i) =>
    `${i + 1}. "${a.title}" — ${a.source}`
  ).join('\n');

  const prompt = `Tag these legal tech news articles. Assign 1-2 tags from: funding, product, regulation, research, acquisition, enterprise.

${list}

Return ONLY a JSON array:
[{"index":1,"tags":["product"]},{"index":2,"tags":["funding"]}]
No markdown, no explanation.`;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    },
    {
      headers: {
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      timeout: 30000
    }
  );

  const raw = (response.data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .replace(/```json|```/g, '')
    .trim();

  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('No JSON from tagging');
  return JSON.parse(match[0]);
}

async function fetchNews() {
  if (!API_KEY) { console.error('No API key set'); process.exit(1); }

  const today = new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  });
  console.log(`Fetching AI legal tech news for ${today}...`);

  // Step 1: Pull RSS feeds
  let allArticles = [];
  for (const query of QUERIES) {
    console.log(`Fetching: ${query}`);
    const items = await fetchRSS(query);
    const recent = items.filter(a => isRecent(a.pubDate));
    console.log(`  → ${recent.length} recent articles`);
    allArticles = allArticles.concat(recent);
    await sleep(500);
  }

  allArticles = deduplicateArticles(allArticles);
  console.log(`✓ ${allArticles.length} unique articles`);

  if (!allArticles.length) {
    console.error('No articles found');
    process.exit(1);
  }

  // Step 2: Tag with Claude Haiku
  console.log('Tagging articles...');
  let tags = [];
  try {
    tags = await tagArticles(allArticles);
    console.log(`✓ Tagged ${tags.length} articles`);
  } catch (e) {
    console.log('Tagging failed, using defaults:', e.message);
    tags = allArticles.map((_, i) => ({ index: i + 1, tags: ['enterprise'] }));
  }

  const tagMap = {};
  tags.forEach(t => { tagMap[t.index] = t.tags; });

  const finalArticles = allArticles.map((a, i) => ({
    title: a.title,
    source: a.source,
    date: today,
    summary: a.summary || 'Click to read the full article.',
    url: a.url,
    tags: tagMap[i + 1] || ['enterprise']
  }));

  // Step 3: Save
  const data = readData();
  const dateKey = new Date().toISOString().split('T')[0];
  data.fetches = data.fetches.filter(f => f.date !== dateKey);
  data.fetches.unshift({
    date: dateKey,
    fetchedAt: new Date().toISOString(),
    articleCount: finalArticles.length,
    articles: finalArticles
  });
  data.fetches = data.fetches.slice(0, 90);
  writeData(data);

  console.log(`✓ Saved ${finalArticles.length} articles`);
  console.log(`✓ Total days in history: ${data.fetches.length}`);
  finalArticles.forEach((a, i) => {
    console.log(`${i + 1}. [${a.tags.join(', ')}] ${a.title}`);
  });
}

fetchNews();
