// Network boundaries. Every failure here is turned into a Chinese, user-facing Error.

export async function readError(response) {
  const text = await response.text().catch(() => '');
  try {
    const json = JSON.parse(text);
    if (json && typeof json.error === 'string') return json.error;
  } catch {}
  const trimmed = text.trim();
  if (trimmed) return trimmed.slice(0, 300);
  return `请求失败（HTTP ${response.status}）`;
}

export async function convertToPdf(file) {
  const form = new FormData();
  form.append('file', file);
  let response;
  try {
    response = await fetch('/api/convert', { method: 'POST', body: form });
  } catch (e) {
    throw new Error(`无法连接本机转换服务：${e.message}`);
  }
  if (!response.ok) throw new Error(await readError(response));
  return response.arrayBuffer();
}

// Streams an answer. `onChunk` receives the accumulated text; `signal` cancels.
export async function explainStream({ config, text, image, mode, history, signal }, onChunk) {
  const response = await fetch('/api/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config, text, image, mode, history }),
    signal,
  });
  if (!response.ok) throw new Error(await readError(response));
  if (!response.body) throw new Error('当前浏览器不支持流式响应');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }
      if (json.error) throw new Error(json.error.message || '模型返回错误');
      const chunk = json.choices?.[0]?.delta?.content;
      if (!chunk) continue;
      answer += chunk;
      onChunk(answer);
    }
  }
  if (!answer.trim()) throw new Error('模型未返回可显示内容，请检查模型与接口地址');
  return answer;
}

export async function testModelConnection(config) {
  const response = await fetch('/api/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}
