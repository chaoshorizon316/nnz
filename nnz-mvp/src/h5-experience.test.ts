import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const html = readFileSync(join(process.cwd(), 'public', 'index.html'), 'utf-8');

const USER_VISIBLE_MECHANISM_TERMS = [
  'SoulVersion',
  'SoulSnapshot',
  'SoulUpdateProposal',
  'MemoryItem',
  'enabledForRuntime',
  'enabledForSoulUpdate',
  'userId',
  'personaId',
  'scope',
  'kernelJson',
  'vector',
  'embedding',
  'LLM prompt',
  'Covenant',
  'ACTIVE',
  'SEALED',
  'NODE',
  'GRADUATED',
  '后台通知',
  '人工审核',
  '极端情绪词汇',
  'AI模型',
  'AI人格',
  '基础 AI 人格',
  '基础AI人格',
  '毕业机制',
  '节点重启',
  '作用域',
  '检索',
  '证据',
  '节点里的',
  '不是我本来就知道',
  '只按',
  '别人的记忆',
] as const;

function functionBody(name: string, asyncFunction = true): string {
  const prefix = asyncFunction ? 'async function' : 'function';
  const start = html.indexOf(`${prefix} ${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const nextAsyncFunction = html.indexOf('\nasync function ', start + 1);
  const nextFunction = html.indexOf('\nfunction ', start + 1);
  const boundaries = [nextAsyncFunction, nextFunction].filter((index) => index !== -1);
  const end = boundaries.length ? Math.min(...boundaries) : undefined;
  return html.slice(start, end);
}

function decodeHtmlEntities(source: string): string {
  return source
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function visibleTextFromHtml(source: string): string {
  const sourceWithoutCode = source
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const textNodes = sourceWithoutCode.replace(/<[^>]+>/g, ' ');
  const visibleAttributes = Array.from(
    sourceWithoutCode.matchAll(/\s(?:aria-label|alt|placeholder|title|value)=["']([^"']*)["']/gi),
    ([, value]) => value ?? '',
  ).join(' ');

  return decodeHtmlEntities(`${textNodes} ${visibleAttributes}`)
    .replace(/\s+/g, ' ')
    .trim();
}

function h5UnsafeErrorFragmentsFromHtml(source: string): string[] {
  const match = source.match(/const H5_UNSAFE_ERROR_FRAGMENTS = \[([\s\S]*?)\];/);
  expect(match).not.toBeNull();
  return Array.from(match![1].matchAll(/'([^']+)'/g), ([, value]) => value ?? '');
}

describe('H5 experience lifecycle controls', () => {
  it('does not expose internal mechanism terms in user-visible H5 copy', () => {
    const visibleText = visibleTextFromHtml(html);
    const leakedTerms = USER_VISIBLE_MECHANISM_TERMS.filter((term) => visibleText.includes(term));

    expect(leakedTerms).toEqual([]);
  });

  it('downloads the user data archive before submitting graduation', () => {
    const graduate = functionBody('h5Graduate');
    const exportCall = graduate.indexOf("await h5Request('/api/me/export')");
    const graduateCall = graduate.indexOf("await h5Request('/api/me/graduate'");

    expect(exportCall).toBeGreaterThanOrEqual(0);
    expect(graduateCall).toBeGreaterThanOrEqual(0);
    expect(exportCall).toBeLessThan(graduateCall);
    expect(graduate).toContain('h5DownloadDataArchive(data.export');
    expect(graduate).toContain('数据档案已交还给你');
  });

  it('uses inline confirmation before graduation instead of a browser confirm', () => {
    const refreshCovenant = functionBody('h5RefreshCovenantState');
    const openGraduate = functionBody('h5OpenGraduateConfirm', false);
    const confirmGraduate = functionBody('h5ConfirmGraduate');

    expect(html).toContain('id="h5GraduateConfirmPanel"');
    expect(html).toContain('输入“告别”确认');
    expect(html).toContain('确认这是此刻想要的告别');
    expect(refreshCovenant).toContain("h5CreateCovenantButton('毕业', 'covenant-btn-graduate', h5OpenGraduateConfirm)");
    expect(html).not.toContain('confirm(');
    expect(openGraduate).toContain("panel.classList.remove('hidden');");
    expect(confirmGraduate).toContain("phrase !== '告别'");
    expect(confirmGraduate).toContain('await h5Graduate();');
  });

  it('uses inline confirmation before sealing a conversation', () => {
    const refreshCovenant = functionBody('h5RefreshCovenantState');
    const openSeal = functionBody('h5OpenSealConfirm', false);
    const confirmSeal = functionBody('h5ConfirmSeal');
    const sealSoul = functionBody('h5SealSoul');

    expect(html).toContain('id="h5SealConfirmPanel"');
    expect(html).toContain('输入“安放”确认');
    expect(html).toContain('确认你想先往前走');
    expect(refreshCovenant).toContain("h5CreateCovenantButton('封存', 'covenant-btn-seal', h5OpenSealConfirm)");
    expect(refreshCovenant).not.toContain('h5CreateCovenantButton(\'封存\', \'covenant-btn-seal\', h5SealSoul)');
    expect(refreshCovenant).toContain("await h5Request('/api/me/covenant-state?personaId='");
    expect(refreshCovenant).not.toContain("fetch('/api/me/covenant-state");
    expect(openSeal).toContain("panel.classList.remove('hidden');");
    expect(openSeal).toContain('h5ToggleMemoryPanel(false);');
    expect(confirmSeal).toContain("phrase !== '安放'");
    expect(confirmSeal).toContain('await h5SealSoul();');
    expect(sealSoul).toContain("const sealed = await h5CovenantAction('/api/me/seal'");
    expect(sealSoul).toContain('if (sealed) h5CancelSealConfirm();');
  });

  it('uses inline confirmation before completing a special moment', () => {
    const refreshCovenant = functionBody('h5RefreshCovenantState');
    const openComplete = functionBody('h5OpenNodeCompleteConfirm', false);
    const confirmComplete = functionBody('h5ConfirmCompleteNode');
    const completeNode = functionBody('h5CompleteNode');

    expect(html).toContain('id="h5NodeCompleteConfirmPanel"');
    expect(html).toContain('输入“收束”确认');
    expect(html).toContain('这个特别时刻会安静收束');
    expect(refreshCovenant).toContain("h5CreateCovenantButton('完成这个时刻', 'covenant-btn-done', h5OpenNodeCompleteConfirm)");
    expect(refreshCovenant).not.toContain("h5CreateCovenantButton('完成这个时刻', 'covenant-btn-done', h5CompleteNode)");
    expect(openComplete).toContain("panel.classList.remove('hidden');");
    expect(openComplete).toContain('h5ToggleMemoryPanel(false);');
    expect(confirmComplete).toContain("phrase !== '收束'");
    expect(confirmComplete).toContain('await h5CompleteNode();');
    expect(completeNode).toContain("const completed = await h5CovenantAction('/api/me/complete-node'");
    expect(completeNode).toContain('if (completed) h5CancelNodeCompleteConfirm();');
  });

  it('requires a named special moment and keeps covenant errors inline', () => {
    const activateNode = functionBody('h5ActivateNode');
    const covenantAction = functionBody('h5CovenantAction');

    expect(html).toContain('id="h5CovenantStatus"');
    expect(activateNode).toContain("const nodeName = input?.value.trim() || ''");
    expect(activateNode).toContain('写下这个时刻的名字后再开启。');
    expect(activateNode).toContain('input?.focus();');
    expect(activateNode).not.toContain("|| '重要时刻'");
    expect(activateNode).toContain('正在开启这个时刻');
    expect(covenantAction).toContain("h5SetStatus('h5CovenantStatus'");
    expect(covenantAction).toContain('await h5Request(url');
    expect(covenantAction).toContain("h5SafeErrorMessage(error, '刚才没有完成，请稍后再试。')");
    expect(covenantAction).not.toContain('await res.json()');
    expect(covenantAction).not.toContain('fetch(url');
    expect(covenantAction).not.toContain("data.error || '刚才没有完成，请稍后再试。'");
    expect(covenantAction).not.toContain('alert(');
  });

  it('renders H5 covenant action controls with DOM event APIs', () => {
    const refreshCovenant = functionBody('h5RefreshCovenantState');
    const createButton = functionBody('h5CreateCovenantButton', false);
    const createNodeInput = functionBody('h5CreateNodeNameInput', false);

    expect(refreshCovenant).toContain("actions.textContent = '';");
    expect(refreshCovenant).toContain('actions.appendChild(h5CreateNodeNameInput());');
    expect(refreshCovenant).toContain("h5CreateCovenantButton('开启时刻', 'covenant-btn-node', h5ActivateNode)");
    expect(refreshCovenant).not.toContain('actions.innerHTML');
    expect(refreshCovenant).not.toContain('onclick=');
    expect(createButton).toContain("document.createElement('button')");
    expect(createButton).toContain('button.textContent = label;');
    expect(createButton).toContain("button.addEventListener('click', onClick);");
    expect(createNodeInput).toContain("document.createElement('input')");
    expect(createNodeInput).toContain("input.id = 'h5NodeName';");
    expect(createNodeInput).toContain("input.placeholder = '例如：婚礼';");
  });

  it('sanitizes H5 runtime errors before displaying them to users', () => {
    const safeError = functionBody('h5SafeErrorMessage', false);
    const request = functionBody('h5Request');
    const guestMode = functionBody('h5GuestMode');
    const loadConversation = functionBody('h5LoadConversation');
    const graduate = functionBody('h5Graduate');
    const sendMessage = functionBody('h5SendMessage');
    const unsafeErrorFragments = h5UnsafeErrorFragmentsFromHtml(html);

    expect(safeError).toContain('H5_UNSAFE_ERROR_FRAGMENTS');
    expect(safeError).toContain('return H5_UNSAFE_ERROR_FRAGMENTS.some');
    expect(unsafeErrorFragments).toEqual(expect.arrayContaining(USER_VISIBLE_MECHANISM_TERMS));
    expect(unsafeErrorFragments).toContain('当前状态不允许');
    expect(unsafeErrorFragments).toContain('节点重启');
    expect(html).toContain("h5SafeErrorMessage(error, '登录已失效，请重新登录。')");
    expect(html).toContain("h5SafeErrorMessage(error, '体验模式暂不可用')");
    expect(html).toContain("h5SafeErrorMessage(error, '操作失败。')");
    expect(html).toContain("h5SafeErrorMessage(error, '导出失败。')");
    expect(html).toContain("h5SafeErrorMessage(error, '删除失败。')");
    expect(html).toContain("h5SafeErrorMessage(error, '创建失败。')");
    expect(html).toContain("h5SafeErrorMessage(error, '保存失败。')");
    expect(request).toContain('await response.text()');
    expect(request).toContain('JSON.parse(rawBody)');
    expect(request).toContain("throw new Error('请求失败。')");
    expect(request).toContain("typeof data.error === 'string'");
    expect(request).toContain('data.error.trim()');
    expect(request).toContain('throw new Error(errorMessage)');
    expect(request).not.toContain("throw new Error((data && data.error) || '请求失败。')");
    expect(request).not.toContain('await response.json()');
    expect(guestMode).toContain("await h5Request('/api/register'");
    expect(guestMode).toContain('skipAuth: true');
    expect(guestMode).toContain("h5SafeErrorMessage(error, '体验模式暂不可用')");
    expect(guestMode).not.toContain("fetch('/api/register'");
    expect(guestMode).not.toContain('await res.json()');
    expect(loadConversation).toContain("h5SafeErrorMessage(error, '读取对话失败，请稍后再试。')");
    expect(graduate).toContain("h5SafeErrorMessage(error, '毕业失败。')");
    expect(sendMessage).toContain("h5SafeErrorMessage(error, '刚才没有发送成功，我们稍后再试。')");
    expect(html).not.toContain("error.message || '毕业失败。'");
    expect(html).not.toContain("error.message || '刚才没有发送成功，我们稍后再试。'");
  });

  it('keeps memory and covenant confirmation panels mutually exclusive', () => {
    const toggleMemory = functionBody('h5ToggleMemoryPanel', false);
    const openGraduate = functionBody('h5OpenGraduateConfirm', false);
    const activateNode = functionBody('h5ActivateNode');

    expect(toggleMemory).toContain('h5CancelSealConfirm();');
    expect(toggleMemory).toContain('h5CancelNodeCompleteConfirm();');
    expect(toggleMemory).toContain('h5CancelGraduateConfirm();');
    expect(openGraduate).toContain('h5ToggleMemoryPanel(false);');
    expect(activateNode).toContain('h5CancelGraduateConfirm();');
    expect(activateNode).toContain('h5ToggleMemoryPanel(false);');
  });

  it('renders persona switcher options with DOM text APIs', () => {
    const updatePersonaList = functionBody('h5UpdatePersonaList', false);

    expect(updatePersonaList).toContain("document.createElement('option')");
    expect(updatePersonaList).toContain('option.value = persona.id;');
    expect(updatePersonaList).toContain('option.textContent = persona.displayName');
    expect(updatePersonaList).toContain('sel.appendChild(option);');
    expect(updatePersonaList).not.toContain('sel.innerHTML = personas.map');
  });

  it('renders H5 onboarding choice controls with DOM text APIs', () => {
    const initQuickNames = functionBody('h5InitQuickNames', false);
    const initTraits = functionBody('h5InitTraits', false);

    expect(initQuickNames).toContain("container.textContent = '';");
    expect(initQuickNames).toContain("document.createElement('button')");
    expect(initQuickNames).toContain('button.textContent = name;');
    expect(initQuickNames).toContain("button.addEventListener('click'");
    expect(initQuickNames).toContain('container.appendChild(button);');
    expect(initQuickNames).not.toContain('container.innerHTML');
    expect(initQuickNames).not.toContain('onclick=');
    expect(initTraits).toContain("container.textContent = '';");
    expect(initTraits).toContain("document.createElement('label')");
    expect(initTraits).toContain("document.createElement('input')");
    expect(initTraits).toContain('labelText.textContent = opt.label;');
    expect(initTraits).toContain('description.textContent = opt.desc;');
    expect(initTraits).toContain("input.addEventListener('change'");
    expect(initTraits).toContain('container.appendChild(groupEl);');
    expect(initTraits).not.toContain('container.innerHTML');
    expect(initTraits).not.toContain('onchange=');
  });

  it('renders H5 conversation bubbles with DOM text APIs', () => {
    const renderConversation = functionBody('h5RenderConversation', false);
    const appendBubble = functionBody('h5AppendBubble', false);
    const createBubble = functionBody('h5CreateBubble', false);

    expect(renderConversation).toContain("container.textContent = '';");
    expect(renderConversation).toContain('container.appendChild(h5CreateBubble(message.role, message.content));');
    expect(renderConversation).not.toContain('container.innerHTML = messages.map');
    expect(renderConversation).not.toContain('h5BubbleHtml');
    expect(appendBubble).toContain('container.appendChild(h5CreateBubble(role, content));');
    expect(appendBubble).not.toContain('insertAdjacentHTML');
    expect(createBubble).toContain("document.createElement('p')");
    expect(createBubble).toContain("text.textContent = String(content || '');");
    expect(createBubble).not.toContain('escapeHtml(content)');
  });

  it('renders H5 loading bubbles with DOM text APIs', () => {
    const appendLoading = functionBody('h5AppendLoading', false);
    const createLoading = functionBody('h5CreateLoadingBubble', false);

    expect(appendLoading).toContain('container.appendChild(h5CreateLoadingBubble());');
    expect(appendLoading).not.toContain('insertAdjacentHTML');
    expect(createLoading).toContain("document.createElement('p')");
    expect(createLoading).toContain("loadingText.textContent = '正在回复……';");
  });

  it('renders marketing consultation chat with DOM text APIs', () => {
    const sendChat = functionBody('sendChat', false);
    const createMarketingChatBubble = functionBody('createMarketingChatBubble', false);

    expect(sendChat).toContain("container.appendChild(createMarketingChatBubble('USER', userContent));");
    expect(sendChat).toContain("container.appendChild(createMarketingChatBubble('ASSISTANT', responseText));");
    expect(sendChat).not.toContain('userMsg.innerHTML');
    expect(sendChat).not.toContain('respMsg.innerHTML');
    expect(sendChat).not.toContain('escapeHtml(roleVal)');
    expect(createMarketingChatBubble).toContain("document.createElement('p')");
    expect(createMarketingChatBubble).toContain("text.textContent = String(content || '');");
    expect(html).not.toContain('function escapeHtml');
  });

  it('does not fall back to displaying raw lifecycle state names', () => {
    expect(html).toContain("badge.textContent = labels[state] || '状态更新中';");
    expect(html).not.toContain('badge.textContent = labels[state] || state;');
  });

  it('shows a persistent support panel when a safety reply appears', () => {
    const renderConversation = functionBody('h5RenderConversation', false);
    const updateSafetySupport = functionBody('h5UpdateSafetySupport', false);

    expect(html).toContain('id="h5SafetySupport"');
    expect(html).toContain('tel:4001619995');
    expect(renderConversation).toContain('h5UpdateSafetySupport(messages);');
    expect(updateSafetySupport).toContain("message.role === 'ASSISTANT'");
    expect(updateSafetySupport).toContain('h5IsSafetySupportReply');
    expect(html).toContain('请现在就联系能真正帮助你的人');
  });

  it('requires boundary and data-rights consent before creating a persona', () => {
    const createPersona = functionBody('h5CreatePersona');
    const showCreatePanel = functionBody('h5ShowCreatePanel', false);

    expect(html).toContain('id="h5ConsentAccepted"');
    expect(html).toContain('不替代身边的人或专业帮助');
    expect(html).toContain('随时导出或删除自己的数据');
    expect(createPersona).toContain("document.getElementById('h5ConsentAccepted')?.checked");
    expect(createPersona).toContain('consentAccepted: true');
    expect(createPersona).toContain('请先确认使用边界和数据权利。');
    expect(createPersona).toContain('h5NextPage(3);');
    expect(showCreatePanel).toContain('h5ConsentAccepted');
    expect(showCreatePanel).toContain('consent.checked = false;');
  });

  it('uses inline confirmation for account deletion without exposing backend confirmation text', () => {
    const openDelete = functionBody('h5OpenDeleteConfirm', false);
    const confirmDelete = functionBody('h5ConfirmDeleteAllData');

    expect(html).toContain('id="h5DeleteConfirmPanel"');
    expect(html).toContain('输入“删除”确认');
    expect(html).toContain('建议先导出一份数据档案');
    expect(html).not.toContain('prompt(');
    expect(openDelete).toContain("panel.classList.remove('hidden');");
    expect(confirmDelete).toContain("confirmText !== '删除'");
    expect(confirmDelete).toContain("body: { confirm: 'DELETE_MY_DATA' }");
  });

  it('lets a signed-in user add a memory for the selected persona', () => {
    const saveMemory = functionBody('h5SaveMemory');
    const renderConversation = functionBody('h5RenderConversation', false);

    expect(html).toContain('id="h5MemoryPanel"');
    expect(html).toContain('写一段已经发生过的细节');
    expect(html).toContain('只补充你愿意留下的内容');
    expect(html).toContain('保存这段记忆');
    expect(saveMemory).toContain("await h5Request('/api/me/memory'");
    expect(saveMemory).toContain('body: { personaId: h5CurrentPersonaId, content }');
    expect(saveMemory).toContain('写下一段想补充的记忆。');
    expect(renderConversation).toContain('段记忆');
    expect(visibleTextFromHtml(html)).not.toContain('MemoryItem');
  });
});
