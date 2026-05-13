const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.ANTHROPIC_API_KEY;
const DATA_FILE = path.join(__dirname, 'data', 'articles.json');

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

// Load existing data or start fresh
function readData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.log('Starting fresh data file');
  }
  return { fetches: [] };
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getTodayKey() {
  return new Date().toISOString().split('T')[0];
}

async function fetchNews() {
  if (!API_KEY) {
    console.error('ERROR: ANTHROPIC_API_KEY environment variable not set');
    process.exit(1);
  }

  const today = new Date().toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  });

  console.log(`Fetching AI legal tech news for ${today}...`);

  const prompt = `Today is ${today}. You are a legal tech news analyst. Perform multiple web searches to find the 25 most important and recent AI legal tech news articles from the past 48-72 hours.

Search specifically for news about:
- Legal AI startups: Harvey, Clio, Legora, EvenUp, Spellbook, Ironclad, Luminance, Relativity, Everlaw, CaseText, Lexis+ AI, Westlaw AI
- Law firm AI adoption and strategy announcements
- Legal AI product launches and updates
- Legaltech startup funding rounds and acquisitions
- Contract AI and CLM tools
- E-discovery AI tools
- AI regulation affecting the legal industry
- AI hallucination cases in court
- In-house legal team AI adoption
- Legal research AI tools

Prioritize sources: Artificial Lawyer, Law360, Legal IT Insider, Legaltech News, Above the Law, Bloomberg Law, Am Law Daily, Legal Futures, TechCrunch, Reuters.

Return ONLY a raw JSON array of 25 articles — no markdown, no code fences, no explanation, no preamble. Start with [ and end with ]. Use this exact shape:
{"title":"...","source":"Publication name","date":"${today}","summary":"Two sentence summary of what happened and why it matters for legal tech.","url":"https://...","tags":["tag"]}

Tags must be one or more from: funding, product, regulation, research, acquisition, enterprise. Each article gets 1-2 tags. Only include real articles with real URLs. Return the raw JSON array only.`;

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      },
      {
        headers: {
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        timeout: 120000
      }
    );

    const textBlocks = (response.data.content || []).filter(b => b.type === 'text');
    const raw = textBlocks.map(b => b.text).join('').replace(/```json|```/g, '').trim();
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array found in response');

    const articles = JSON.parse(match[0]);
    if (!Array.isArray(articles) || !articles.length) throw new Error('Empty article list returned');

    console.log(`✓ Fetched ${articles.length} articles`);

    // Save to persistent storage
    const data = readData();
    const dateKey = getTodayKey();

    // Remove existing entry for today if re-running
    data.fetches = data.fetches.filter(f => f.date !== dateKey);

    // Add today's fetch at the top
    data.fetches.unshift({
      date: dateKey,
      fetchedAt: new Date().toISOString(),
      articleCount: articles.length,
      articles: articles
    });

    // Keep last 90 days of history
    data.fetches = data.fetches.slice(0, 90);

    writeData(data);
    console.log(`✓ Saved to ${DATA_FILE}`);
    console.log(`✓ Total days in history: ${data.fetches.length}`);

    // Print summary to console
    console.log('\n--- TODAY\'S ARTICLES ---');
    articles.forEach((a, i) => {
      console.log(`${i + 1}. [${(a.tags || []).join(', ')}] ${a.title} — ${a.source}`);
    });

  } catch (error) {
    if (error.response) {
      console.error('API Error:', error.response.status, JSON.stringify(error.response.data));
    } else {
      console.error('Error:', error.message);
    }
    process.exit(1);
  }
}

fetchNews();
