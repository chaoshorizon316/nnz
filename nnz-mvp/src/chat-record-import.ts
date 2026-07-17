export type ChatRecordFormat = 'txt' | 'json';

export interface ChatRecordUploadInput {
  content?: string;
  fileName?: string;
  format?: string;
}

export interface ParsedChatRecordUpload {
  format: ChatRecordFormat;
  messageCount: number;
  excerpt: string;
  truncated: boolean;
}

interface ParsedChatLine {
  speaker?: string;
  text: string;
}

export const CHAT_RECORD_ACCEPTED_EXTENSIONS = '.txt,.json';
export const CHAT_RECORD_FORMAT_HINT =
  '推荐 UTF-8 .txt，一行一条，格式为“说话人：内容”；也支持 .json，根对象含 messages 数组。';

const MAX_UPLOAD_CHARS = 120_000;
const MAX_IMPORTED_LINES = 80;
const MAX_LINE_CHARS = 220;
const MAX_EXCERPT_CHARS = 6_000;

export class ChatRecordUploadError extends Error {}

export function parseChatRecordUpload(input: ChatRecordUploadInput): ParsedChatRecordUpload {
  const content = input.content ?? '';
  if (!content.trim()) {
    throw new ChatRecordUploadError('请上传有内容的聊天记录文件。');
  }
  if (content.length > MAX_UPLOAD_CHARS) {
    throw new ChatRecordUploadError('聊天记录文件过大，请先删减后再上传。');
  }

  const format = detectChatRecordFormat(input.format, input.fileName);
  const lines = format === 'json' ? parseJsonChatLines(content) : parseTxtChatLines(content);
  if (lines.length === 0) {
    throw new ChatRecordUploadError('没有读到可导入的聊天内容。');
  }

  const importedLines = lines.slice(0, MAX_IMPORTED_LINES);
  const body = importedLines.map(formatChatLine).join('\n');
  const prefix = '这是一段用户上传的聊天记录摘录：\n';
  const excerpt = `${prefix}${body}`.slice(0, MAX_EXCERPT_CHARS);

  return {
    format,
    messageCount: importedLines.length,
    excerpt,
    truncated: lines.length > importedLines.length || `${prefix}${body}`.length > MAX_EXCERPT_CHARS,
  };
}

export function detectChatRecordFormat(format?: string, fileName?: string): ChatRecordFormat {
  const normalizedFormat = (format ?? '').trim().toLowerCase();
  if (normalizedFormat === 'txt' || normalizedFormat === 'json') return normalizedFormat;

  const normalizedFileName = (fileName ?? '').trim().toLowerCase();
  if (normalizedFileName.endsWith('.txt')) return 'txt';
  if (normalizedFileName.endsWith('.json')) return 'json';

  throw new ChatRecordUploadError('请上传 .txt 或 .json 格式的聊天记录。');
}

function parseTxtChatLines(content: string): ParsedChatLine[] {
  return content
    .split(/\r?\n/)
    .map(parseTxtLine)
    .filter((line): line is ParsedChatLine => Boolean(line));
}

function parseTxtLine(line: string): ParsedChatLine | null {
  const normalized = normalizeChatText(stripDatePrefix(line), MAX_LINE_CHARS);
  if (!normalized || isIgnorableLine(normalized)) return null;

  const speakerMatch = normalized.match(/^([^:：]{1,24})[:：]\s*(.+)$/);
  if (!speakerMatch) return { text: normalized };

  const speaker = normalizeChatText(speakerMatch[1], 24);
  const text = normalizeChatText(speakerMatch[2], MAX_LINE_CHARS);
  if (!text) return null;
  return speaker ? { speaker, text } : { text };
}

function parseJsonChatLines(content: string): ParsedChatLine[] {
  let root: unknown;
  try {
    root = JSON.parse(content);
  } catch {
    throw new ChatRecordUploadError('JSON 文件无法读取，请检查格式。');
  }

  const messages = Array.isArray(root)
    ? root
    : isRecord(root) && Array.isArray(root.messages)
      ? root.messages
      : null;
  if (!messages) {
    throw new ChatRecordUploadError('JSON 文件需要包含 messages 数组。');
  }

  return messages
    .map(parseJsonMessage)
    .filter((line): line is ParsedChatLine => Boolean(line));
}

function parseJsonMessage(message: unknown): ParsedChatLine | null {
  if (typeof message === 'string') {
    const text = normalizeChatText(message, MAX_LINE_CHARS);
    return text && !isIgnorableLine(text) ? { text } : null;
  }
  if (!isRecord(message)) return null;

  const text = normalizeChatText(
    readFirstStringField(message, ['text', 'content', 'message']),
    MAX_LINE_CHARS,
  );
  if (!text || isIgnorableLine(text)) return null;

  const speaker = normalizeChatText(
    readFirstStringField(message, ['speaker', 'sender', 'name', 'role']),
    24,
  );
  return speaker ? { speaker, text } : { text };
}

function formatChatLine(line: ParsedChatLine): string {
  return line.speaker ? `${line.speaker}: ${line.text}` : line.text;
}

function stripDatePrefix(line: string): string {
  return line.replace(/^\s*\[?\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\]?\s*/, '');
}

function normalizeChatText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function isIgnorableLine(line: string): boolean {
  return /^[-=]{3,}$/.test(line)
    || /^聊天记录/.test(line)
    || /^以下为/.test(line)
    || line.includes('撤回了一条消息');
}

function readFirstStringField(source: Record<string, unknown>, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = source[field];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
