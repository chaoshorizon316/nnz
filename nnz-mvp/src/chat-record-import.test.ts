import { describe, expect, it } from 'vitest';

import {
  CHAT_RECORD_FORMAT_HINT,
  ChatRecordUploadError,
  detectChatRecordFormat,
  parseChatRecordUpload,
} from './chat-record-import';

describe('chat record import', () => {
  it('parses UTF-8 txt chat records into a bounded excerpt', () => {
    const result = parseChatRecordUpload({
      fileName: '聊天记录.txt',
      content: [
        '聊天记录',
        '2026-01-01 10:00 我：今天想起你以前做的番茄面。',
        '爸爸：别忘了先把番茄炒软。',
        '我撤回了一条消息',
      ].join('\n'),
    });

    expect(result.format).toBe('txt');
    expect(result.messageCount).toBe(2);
    expect(result.excerpt).toContain('我: 今天想起你以前做的番茄面。');
    expect(result.excerpt).toContain('爸爸: 别忘了先把番茄炒软。');
    expect(result.excerpt).not.toContain('撤回了一条消息');
  });

  it('parses structured json chat records', () => {
    const result = parseChatRecordUpload({
      fileName: 'chat.json',
      content: JSON.stringify({
        messages: [
          { speaker: '我', text: '今天走到老路口了。' },
          { sender: '妈妈', content: '慢慢走，别着急。' },
        ],
      }),
    });

    expect(result.format).toBe('json');
    expect(result.messageCount).toBe(2);
    expect(result.excerpt).toContain('我: 今天走到老路口了。');
    expect(result.excerpt).toContain('妈妈: 慢慢走，别着急。');
  });

  it('rejects unsupported file formats with a user-safe message', () => {
    expect(() => detectChatRecordFormat(undefined, 'chat.docx')).toThrow(ChatRecordUploadError);
    expect(() => detectChatRecordFormat(undefined, 'chat.docx')).toThrow('请上传 .txt 或 .json 格式的聊天记录。');
  });

  it('documents the user-facing accepted format', () => {
    expect(CHAT_RECORD_FORMAT_HINT).toContain('UTF-8 .txt');
    expect(CHAT_RECORD_FORMAT_HINT).toContain('说话人：内容');
    expect(CHAT_RECORD_FORMAT_HINT).toContain('.json');
  });
});
