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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callClaude(messages, useSearch) {
  const body = {
    model: 'claude-sonnet-4-5',
    max_tokens: 4000,
    messages
  };
  if (useSearch) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
  }
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    body,
    {
      headers: {
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      timeout: 120000
    }
  );
  return response.data;
}

async function fetchNews() {
  if (!API_KEY) { console.error('No API key'); process.exit(1); }

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  console.log(`Fetching news for ${today}...`);

  try {
    // Step 1: Search
    const searchData = await callClaude([{
      role: 'user',
      content: `Search the web for 15 recent AI legal tech news articles from the past 48 hours. Focus on: Harvey, Clio, Legora, EvenUp, Ironclad, Luminance, Relativity, Everlaw, CaseText, law firm AI, legaltech funding, contract AI, e-discovery AI, legal AI regulation. Sources: Artificial Lawyer, Law360, Legal IT Insider, Legaltech News, Above the Law, Bloomberg Law. Briefly summarize each article you find with title, source, and URL.`
    }], true);

    const searchText = (searchData.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    console.log('Search complete, waiting before formatting...');
    await sleep(65000); // wait 65 seconds to reset rate limit

    // Step 2: Format
    const formatData = await callClaude([{
      role: 'user',
      content: `Format these news summaries as a JSON array. Today is ${today}.

${searchText.slice(0, 8000)}

Return ONLY a JSON array, each item:
{"title":"...","source":"...","date":"${today}","summary":"Two sentences.","url":"https://...","tags":["tag"]}
Tags: funding, product, regulation, research, acquisition, enterprise.
Start with [ end with ]. No markdown. JSON only.`
    }], false);

    const raw = (formatData.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .replace(/```json|```/g, '')
      .trim();

    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array found');

    const articles = JSON.parse(match[0]);
    if (!Array.isArray(articles) || !articles.length) throw new Error('Empty list');

    console.log(`✓ Fetched ${articles.length} articles`);

    const data = readData();
    const dateKey = new Date().toISOString().split('T')[0];
    data.fetches = data.fetches.filter(f => f.date !== dateKey);
    data.fetches.unshift({
      date: dateKey,
      fetchedAt: new Date().toISOString(),
      articleCount: articles.length,
      articles
    });
    data.fetches = data.fetches.slice(0, 90);
    writeData(data);
    console.log(`✓ Saved. Total days: ${data.fetches.length}`);

  } catch (error) {
    console.error('Error:', error.response ? JSON.stringify(error.response.data) : error.message);
    process.exit(1);
  }
}

fetchNews();
