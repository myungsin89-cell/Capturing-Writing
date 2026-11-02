import hanspell from 'hanspell';
import { MAX_SPELLCHECK_LENGTH, splitSpellcheckText, mapSpellcheckSuggestions } from '../src/utils/spellcheck.js';

export function validateSpellcheckInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some((key) => !['title', 'text'].includes(key)) ||
      typeof input.title !== 'string' || typeof input.text !== 'string') {
    throw new Error('INVALID_INPUT');
  }
  if (!input.title.trim() && !input.text.trim()) throw new Error('EMPTY_INPUT');
  if (input.title.length > 50 || input.title.length + input.text.length > MAX_SPELLCHECK_LENGTH) throw new Error('TOO_LONG');
  return { title: input.title, text: input.text };
}

function checkWithHanspell(text) {
  return new Promise((resolve, reject) => {
    const items = [];
    const timer = setTimeout(() => reject(new Error('PROVIDER_TIMEOUT')), 8000);
    hanspell.spellCheckByDAUM(text, 6000, (batch) => {
      if (Array.isArray(batch)) items.push(...batch);
    }, () => { clearTimeout(timer); resolve(items); }, () => {
      clearTimeout(timer); reject(new Error('PROVIDER_UNAVAILABLE'));
    });
  });
}

export async function checkWriting(input, check = checkWithHanspell) {
  const document = validateSpellcheckInput(input);
  const issues = [];
  const deadline = Date.now() + 24000;
  for (const field of ['title', 'text']) {
    for (const chunk of splitSpellcheckText(document[field])) {
      if (Date.now() > deadline) throw new Error('PROVIDER_TIMEOUT');
      const suggestions = await check(chunk.text);
      if (!Array.isArray(suggestions)) throw new Error('PROVIDER_UNAVAILABLE');
      issues.push(...mapSpellcheckSuggestions(chunk.text, suggestions, field, chunk.start));
    }
  }
  const unique = new Map();
  for (const issue of issues) {
    const key = JSON.stringify([issue.field, issue.start, issue.original, issue.context, issue.suggestions]);
    if (!unique.has(key)) unique.set(key, issue);
  }
  return { issues: [...unique.values()] };
}
