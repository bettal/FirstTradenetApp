import { useState, useEffect, useCallback } from 'react';
import SlidePanel from '../components/SlidePanel';
import GlassInput from '../components/GlassInput';
import GlassButton from '../components/GlassButton';
import { getCommands, executeWalletCommand } from '../api';

export default function ApiExplorer({ open, onClose, wallet }) {
  const [commands, setCommands] = useState([]);
  const [categories, setCategories] = useState(new Map());
  const [category, setCategory] = useState('');
  const [command, setCommand] = useState('');
  const [params, setParams] = useState([]);
  const [paramValues, setParamValues] = useState({});
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open && wallet) {
      getCommands().then(cmds => {
        setCommands(cmds);
        const cats = new Map();
        cmds.forEach(c => { if (!cats.has(c.category)) cats.set(c.category, c.category_display); });
        setCategories(cats);
      }).catch(() => {});
    }
  }, [open, wallet]);

  const handleCategoryChange = (cat) => {
    setCategory(cat);
    setCommand('');
    setParams([]);
    setParamValues({});
  };

  const handleCommandChange = (cmdName) => {
    setCommand(cmdName);
    const def = commands.find(c => c.name === cmdName);
    setParams(def?.params || []);
    setParamValues({});
  };

  const handleParamChange = (name, value, type) => {
    setParamValues(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!command) {
      setError('Select a command');
      return;
    }
    setLoading(true);
    setError('');
    setResponse('Loading...');

    const builtParams = {};
    params.forEach(p => {
      const val = paramValues[p.name] ?? p.default ?? '';
      if (p.type === 'int') builtParams[p.name] = parseInt(val, 10) || 0;
      else if (p.type === 'float') builtParams[p.name] = parseFloat(val) || 0;
      else if (p.type === 'bool') builtParams[p.name] = val === 'true' || val === true;
      else if (p.type === 'json') {
        try { builtParams[p.name] = JSON.parse(val || '{}'); } catch { builtParams[p.name] = {}; }
      }
      else builtParams[p.name] = String(val);
    });

    try {
      const data = await executeWalletCommand(wallet.id, command, builtParams);
      setResponse(JSON.stringify(data, null, 2));
    } catch {
      setResponse('Network error');
      setError('Request failed');
    } finally {
      setLoading(false);
    }
  };

  const filteredCommands = category ? commands.filter(c => c.category === category) : [];

  return (
    <SlidePanel
      open={open}
      onClose={onClose}
      title={`API Explorer${wallet ? ': ' + wallet.name : ''}`}
      width="640px"
    >
      <div className="grid-2" style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* Input */}
        <div>
          <form onSubmit={handleSubmit}>
            <GlassInput
              label="Category"
              type="select"
              value={category}
              onChange={e => handleCategoryChange(e.target.value)}
            >
              <option value="">-- Select Category --</option>
              {[...categories].map(([key, display]) => (
                <option key={key} value={key}>{display}</option>
              ))}
            </GlassInput>

            <GlassInput
              label="Command"
              type="select"
              value={command}
              onChange={e => handleCommandChange(e.target.value)}
            >
              <option value="">-- Select Command --</option>
              {filteredCommands.map(c => (
                <option key={c.name} value={c.name}>{c.display_name}</option>
              ))}
            </GlassInput>

            {params.map(p => (
              <GlassInput
                key={p.name}
                label={`${p.name}${p.required ? ' *' : ''}`}
                type={p.type === 'bool' ? 'select' : p.type === 'json' ? 'textarea' : p.type === 'int' || p.type === 'float' ? 'number' : 'text'}
                hint={p.description}
                value={paramValues[p.name] ?? p.default ?? ''}
                onChange={e => handleParamChange(p.name, e.target.value, p.type)}
                step={p.type === 'float' ? '0.01' : undefined}
                placeholder={String(p.default ?? '')}
              >
                {p.type === 'bool' && (
                  <>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </>
                )}
              </GlassInput>
            ))}

            {error && <div className="form-error mb-2">{error}</div>}
            <GlassButton type="submit" disabled={loading} style={{ width: '100%' }}>
              {loading ? 'Sending...' : 'Send Request'}
            </GlassButton>
          </form>
        </div>

        {/* Response */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <span className="form-label" style={{ marginBottom: '0.5rem' }}>Response</span>
          <div className="code-block" style={{ flex: 1, minHeight: 200, maxHeight: 'calc(100vh - 300px)', overflow: 'auto' }}>
            {response || 'Select a command and click Send'}
          </div>
        </div>
      </div>
    </SlidePanel>
  );
}
