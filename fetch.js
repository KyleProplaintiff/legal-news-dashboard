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
  'EvenUp+AI+OR+Spellbook+AI+OR+CaseText',
  'Thomson+Reuters+AI+OR+LexisNexis+AI+OR+Westlaw+AI',
  'BigLaw+artificial+intelligence',
  'legal+AI+hallucination+OR+sanctions',
  'in-house+counsel+AI+OR+general+counsel+AI',
];

const REQUIRED_KEYWORDS = [
  'legal', 'law firm', 'lawyer', 'attorney', 'legaltech', 'legal tech',
  'harvey', 'clio', 'legora', 'ironclad', 'luminance', 'everlaw', 'relativity',
  'evenup', 'spellbook', 'casetext', 'lexisnexis', 'westlaw', 'thomson reuters',
  'e-discovery', 'ediscovery', 'contract ai', 'clm', 'in-house counsel',
  'general counsel', 'biglaw', 'litigation', 'court', 'judge', 'legal ops'
];

const EXCLUDE_KEYWORDS = [
  'sports', 'football', 'basketball', 'soccer', 'nfl', 'nba', 'mlb', 'nhl',
  'celebrity', 'entertainment', 'music', 'movie', 'fashion', 'recipe',
  'travel', 'weather', 'crypto', 'bitcoin', 'real estate',
  'hospital', 'vaccine', 'climate'
];

function isRelevant(article) {
  const text = (article.title + ' ' + article.summary).toLowerCase();
  const hasRequired = REQUIRED_KEYWORDS.some(k => text.includes(k));
  const hasExcluded = EXCLUDE_KEYWORDS.some(k => text.includes(k));
  return hasRequired && !hasExcluded;
}

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
      title: item.title?.[0]?.replace(/\s*-\s*[^-]+$/, '').trim() || '',
      url: item.link?.[0] || '',
      source: item.source?.[0]?._ || item.source?.[0] || 'Unknown',
      pubDate: item.pubDate?.[0] || '',
      summary: item.description?.[0]?.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) || ''
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

async function tagAndScoreArticles(articles) {
  const list = articles.map((a, i) =>
    `${i + 1}. "${a.title}" — ${a.source}`
  ).join('\n');

  const prompt = `You are analyzing legal tech news articles. For each article do two things:

1. Assign 1-2 tags from ONLY these options:
- "funding" = startup funding, venture capital, investment, valuation, Series A/B/C
- "product" = new product launch, feature release, software update, new tool, beta
- "regulation" = laws, regulations, court rules, AI policy, government, compliance, ethics, sanctions
- "research" = studies, surveys, reports, analysis, statistics, trends
- "acquisition" = mergers, acquisitions, buyouts, partnerships, deals
- "enterprise" = law firm adoption, in-house legal, BigLaw strategy, legal ops

2. Assign a heat score 1-10 for how directly relevant this is to AI legal tech:
- 9-10 = directly about AI tools, funding, or strategy in legal industry
- 7-8 = about AI in law firms or legal departments
- 5-6 = about legal industry with some AI angle
- 3-4 = loosely related to legal tech
- 1-2 = barely relevant, general legal news

Articles:
${list}

Return ONLY a JSON array:
[{"index":1,"tags":["product"],"heat":9},{"index":2,"tags":["funding"],"heat":7}]
No markdown, no explanation. JSON only.`;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
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

  let allArticles = [];
  for (const query of QUERIES) {
    console.log(`Fetching: ${query}`);
    const items = await fetchRSS(query);
    const recent = items.filter(a => isRecent(a.pubDate));
    console.log(`  -> ${recent.length} recent articles`);
    allArticles = allArticles.concat(recent);
    await sleep(500);
  }

  allArticles = deduplicateArticles(allArticles);
  console.log(`Total unique: ${allArticles.length}`);
  allArticles = allArticles.filter(isRelevant);
  console.log(`After relevance filter: ${allArticles.length}`);

  if (!allArticles.length) {
    console.error('No relevant articles found');
    process.exit(1);
  }

  console.log('Tagging and scoring articles...');
  let results = [];
  try {
    results = await tagAndScoreArticles(allArticles);
    console.log(`Tagged and scored ${results.length} articles`);
  } catch (e) {
    console.log('Tagging failed, using defaults:', e.message);
    results = allArticles.map((_, i) => ({ index: i + 1, tags: ['enterprise'], heat: 5 }));
  }

  const resultMap = {};
  results.forEach(r => { resultMap[r.index] = r; });

  const finalArticles = allArticles.map((a, i) => ({
    title: a.title,
    source: a.source,
    date: today,
    summary: a.summary || 'Click to read the full article.',
    url: a.url,
    tags: resultMap[i + 1]?.tags || ['enterprise'],
    heat: resultMap[i + 1]?.heat || 5
  }));

  finalArticles.sort((a, b) => b.heat - a.heat);

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

  console.log(`Saved ${finalArticles.length} articles`);
  console.log(`Total days in history: ${data.fetches.length}`);
  finalArticles.forEach((a, i) => {
    console.log(`${i + 1}. [heat:${a.heat}] [${a.tags.join(', ')}] ${a.title}`);
  });
}

fetchNews();
