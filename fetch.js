const axios = require('axios');
const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');

const API_KEY = process.env.ANTHROPIC_API_KEY;
const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_CHANNEL = '#legal-tech-news';
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
  'e-discovery', 'ediscover
