import { useEffect, useState } from 'react';
import { api } from '../api/client';

export default function Dashboard() {
  const [sites, setSites] = useState([]);
  const [site, setSite] = useState('');
  const [mode, setMode] = useState('week');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.listSites()
      .then((res) => {
        const list = res.sites || [];
        setSites(list);
        if (list[0]?.slug) setSite(list[0].slug);
      })
      .catch(() => setSites([]));
  }, []);

  async function load() {
    if (!site) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.dashboard({ site, mode });
      setData(res);
    } catch (err) {
      setData(null);
      setError(err.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (site) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, mode]);

  const totals = data?.totals;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Quick order totals for a site.</p>
        </div>
      </header>

      <section className="panel">
        <div className="filters">
          <label>
            Site
            <select value={site} onChange={(e) => setSite(e.target.value)}>
              <option value="">Select site</option>
              {sites.map((s) => (
                <option key={s._id || s.slug} value={s.slug}>
                  {s.name || s.slug}
                </option>
              ))}
            </select>
          </label>
          <label>
            Period
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </label>
          <button type="button" className="btn" onClick={load} disabled={!site || loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </section>

      {error && <div className="alert error">{error}</div>}

      <section className="stats">
        <article className="stat">
          <span>Orders</span>
          <strong>{totals?.orders ?? '—'}</strong>
        </article>
        <article className="stat">
          <span>Revenue</span>
          <strong>{totals ? `$${Number(totals.revenue).toFixed(2)}` : '—'}</strong>
        </article>
        <article className="stat">
          <span>Customers</span>
          <strong>{totals?.customersUnique ?? '—'}</strong>
        </article>
        <article className="stat">
          <span>Menu items</span>
          <strong>{totals?.menuUnique ?? '—'}</strong>
        </article>
      </section>

      {data?.labels?.length > 0 && (
        <section className="panel">
          <h2>Daily orders</h2>
          <div className="bars">
            {data.labels.map((label, i) => {
              const max = Math.max(...data.orders, 1);
              const height = Math.round((data.orders[i] / max) * 100);
              return (
                <div className="bar-col" key={`${label}-${i}`}>
                  <div className="bar" style={{ height: `${height}%` }} title={`${data.orders[i]} orders`} />
                  <span>{label}</span>
                  <small>{data.orders[i]}</small>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
