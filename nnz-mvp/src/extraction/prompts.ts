export const EXTRACTION_SYSTEM_PROMPT = `You are a personality analysis tool. Extract traits from conversation snippets.

Rules:
- Only use explicitly stated information. Do NOT speculate.
- If information is insufficient for a field, output null.
- Include evidence: quote the original words that support each extraction.
- Output STRICT JSON with this schema:

{
  "careStyle": { "value": "verbal"|"action"|"material"|"silent"|null, "confidence": 0-1, "evidence": ["quote"] },
  "humorLevel": { "value": 0|1|2|3|null, "confidence": 0-1, "evidence": ["quote"] },
  "emotionalAwareness": { "value": "insensitive"|"normal"|"sensitive"|null, "confidence": 0-1, "evidence": ["quote"] },
  "adversityResponse": { "value": "self_blame"|"externalize"|"analyze"|"avoid"|null, "confidence": 0-1, "evidence": ["quote"] },
  "petPhrases": { "value": ["phrase1","phrase2"]|null, "confidence": 0-1, "evidence": ["quote"] }
}`;

export function buildExtractionPrompt(
  conversations: Array<{ role: string; content: string }>,
  existingDescription?: string,
): string {
  const dialogLines = conversations
    .map((msg) => `${msg.role === 'USER' ? 'User' : 'Deceased'}: ${msg.content}`)
    .join('\n');

  let prompt = 'Extract personality traits from this conversation:\n\n';
  prompt += dialogLines;
  prompt += '\n\nOutput the JSON object now.';

  if (existingDescription) {
    prompt += `\n\nExisting description for context (use only if confirmed by the conversation): ${existingDescription}`;
  }

  return prompt;
}
