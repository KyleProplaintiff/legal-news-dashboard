const axios = require('axios');
const fs = require('fs');
const path = require('path');

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

async function fetchNews() {
  if (!API_KEY) { console.error('No API key'); process.exit(1); }

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  console.log(`Fetching news for ${today}...`);

  const prompt = `Today is ${today}. Search the web for 20 recent AI legal tech news articles from the past 48 hours.

Focus on:
- Legal AI startups: Harvey, Clio, Legora, EvenUp, Spellbook, Ironclad, Luminance, Relativity, Everlaw, CaseText, Lexis+ AI, Westlaw AI
- Law firm AI adoption and strategy
- Legal AI product launches and updates
- Legaltech funding rounds and acquisitions
- Contract AI and CLM tools
- E-discovery AI
- AI regulation affecting legal industry
- AI hallucination court cases
- In-house legal AI adoption

Sources to prioritize: Artificial Lawyer, Law360, Legal IT Insider, Legaltech News, Above the Law, Bloomberg Law, Legal Futures, TechCrunch, Reuters.

Return ONLY a raw JSON array. No markdown, no code fences, no explanation. Each item:
{"title":"...","source":"...","date":"${today}","summary":"Two sentences on what happened and why it matters.","url":"https://...","tags":["tag"]}

Tags: funding, product, regulation, research, acquisition, or enterprise. Return JSON only.`;

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-5',
        max_tokens: 16000,
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
    if (!match) throw new Error('No JSON array found');

    const articles = JSON.parse(match[0]);
    if (!Array.isArray(articles) || !articles.length) throw new Error('Empty list');

    console.log(`✓ Fetched ${articles.length} articles`);

    const data = readData();
    const dateKey = new Date().toISOString().split('T')[0];
    data.fetches = data.fetches.filter(f => f.date !== dateKey);
    data.fetches.unshift({ date: dateKey, fetchedAt: new Date().toISOString(), articleCount: articles.length, articles });
    data.fetches = data.fetches.slice(0, 90);
    writeData(data);
    console.log(`✓ Saved. Total days: ${data.fetches.length}`);

  } catch (error) {
    console.error('Error:', error.response ? JSON.stringify(error.response.data) : error.message);
    process.exit(1);
  }
}

fetchNews();
