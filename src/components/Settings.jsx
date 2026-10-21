import { useRef, useState } from 'react';
import { testModelConnection } from '../lib/api.js';
import { useFocusTrap } from '../lib/hooks.js';
import Icon from './Icon.jsx';

export const PRESETS = {
  DeepSeek: { base: 'https://api.deepseek.com', model: 'deepseek-chat' },
  OpenAI: { base: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  '自定义': { base: '', model: '' },
};

export default function Settings({ config, onConfig, onClose, theme, onTheme, storageUsage }) {
  const box = useRef(null);
  const [preset, setPreset] = useState(() =>
    Object.keys(PRESETS).find((key) => PRESETS[key].base === config.base) || '自定义',
  );
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);
  useFocusTrap(true, box, onClose);

  const applyPreset = (key) => {
    setPreset(key);
    setResult(null);
    if (PRESETS[key].base) onConfig({ ...config, ...PRESETS[key] });
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    const started = performance.now();
    try {
      const data = await testModelConnection(config);
      const latency = Math.round(performance.now() - started);
      const models = Array.isArray(data.models) ? data.models.slice(0, 4) : [];
      setResult({
        tone: 'ok',
        text: `连接成功（${latency} ms）${models.length ? ` · 例如 ${models.join('、')}` : ''}`,
      });
    } catch (error) {
      setResult({ tone: 'error', text: error.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="modal" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="settings" ref={box} role="dialog" aria-modal="true" aria-label="模型设置">
        <button type="button" className="close" aria-label="关闭设置" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
        <span className="eyebrow">YOUR MODEL, YOUR CHOICE</span>
        <h2>连接你的 AI 模型</h2>
        <p>兼容 OpenAI Chat Completions API。请求由本机 Go 服务转发，Key 不会写入磁盘。</p>

        <label>
          服务预设
          <select value={preset} onChange={(event) => applyPreset(event.target.value)}>
            {Object.keys(PRESETS).map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </label>

        <label>
          API Base URL
          <input
            type="text"
            spellCheck="false"
            value={config.base}
            placeholder="https://api.example.com/v1"
            onChange={(event) => onConfig({ ...config, base: event.target.value })}
          />
        </label>
        <label>
          模型名称
          <input
            type="text"
            spellCheck="false"
            value={config.model}
            placeholder="deepseek-chat"
            onChange={(event) => onConfig({ ...config, model: event.target.value })}
          />
        </label>
        <label>
          API Key
          <input
            type="password"
            value={config.key}
            placeholder="sk-…"
            autoComplete="off"
            onChange={(event) => onConfig({ ...config, key: event.target.value })}
          />
        </label>

        {result && <div className={`test-result ${result.tone}`}>{result.text}</div>}

        <div className="settings-row">
          <button type="button" onClick={test} disabled={testing || !config.key || !config.model}>
            {testing ? '测试中…' : '测试连接'}
          </button>
          <div className="segmented theme-switch" role="group" aria-label="主题">
            <button type="button" className={theme === 'light' ? 'active' : ''} onClick={() => onTheme('light')}>
              浅色
            </button>
            <button type="button" className={theme === 'dark' ? 'active' : ''} onClick={() => onTheme('dark')}>
              深色
            </button>
          </div>
        </div>

        <small className="settings-note">
          Key 仅保存在当前页面内存，刷新后需要重新填写；地址、模型与主题保存在本机。
          {storageUsage ? ` 本地已用 ${(storageUsage / 1024 / 1024).toFixed(1)} MB 存储文档与批注。` : ''}
        </small>
        <button type="button" className="primary" onClick={onClose}>
          完成
        </button>
      </div>
    </div>
  );
}
