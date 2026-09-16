import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function cents(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `$${(Number(n) / 100).toFixed(2)}`;
}

const STATUS_OPTIONS = [
  'new', 'created', 'processing', 'accepted', 'preparing', 'prepared',
  'dispatched', 'fulfilled', 'complete', 'completed',
];

export default function Orders() {
  const [sites, setSites] = useState([]);
  const [site, setSite] = useState('');
  const [mode, setMode] = useState('day');
  const [date, setDate] = useState(todayISO());
  const [rangeMode, setRangeMode] = useState('week');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    api.listSites()
      .then((data) => {
        const list = data.sites || [];
        setSites(list);
        if (list[0]?.slug) setSite(list[0].slug);
      })
      .catch(() => setSites([]));
  }, []);

  async function loadOrders() {
    if (!site) {
      setError('Select a site');
      return;
    }
    setLoading(true);
    setError('');
    setMessage('');
    try {
      let data;
      if (mode === 'day') {
        data = await api.ordersByDay({ site, date, extraDays: 2 });
      } else {
        data = await api.ordersByRange({
          site,
          mode: rangeMode,
          start,
          end,
        });
      }
      setOrders(data.orders || []);
      setMessage(`${data.count ?? data.orders?.length ?? 0} orders`);
    } catch (err) {
      setOrders([]);
      setError(err.message || 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (site) loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site]);

  async function changeStatus(orderId, status) {
    setError('');
    setMessage('');
    try {
      await api.updateOrderStatus(orderId, status);
      setMessage(`Status updated to ${status}`);
      setSelected((prev) => (prev && prev._id === orderId ? { ...prev, status } : prev));
      await loadOrders();
    } catch (err) {
      setError(err.message || 'Status update failed');
    }
  }

  const siteLabel = useMemo(
    () => sites.find((s) => s.slug === site)?.name || site,
    [sites, site]
  );

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Orders</h1>
          <p>Browse and update order status{siteLabel ? ` — ${siteLabel}` : ''}.</p>
        </div>
        <button type="button" className="btn" onClick={loadOrders} disabled={loading || !site}>
          Refresh
        </button>
      </header>

      <section className="panel">
        <div className="filters wrap">
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
            View
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="day">By day</option>
              <option value="range">By range</option>
            </select>
          </label>

          {mode === 'day' ? (
            <label>
              Date
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          ) : (
            <>
              <label>
                Range
                <select value={rangeMode} onChange={(e) => setRangeMode(e.target.value)}>
                  <option value="week">Last 7 days</option>
                  <option value="month">Last 30 days</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              {rangeMode === 'custom' && (
                <>
                  <label>
                    Start
                    <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
                  </label>
                  <label>
                    End
                    <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
                  </label>
                </>
              )}
            </>
          )}

          <button type="button" className="btn primary" onClick={loadOrders} disabled={!site || loading}>
            {loading ? 'Loading…' : 'Load'}
          </button>
        </div>
      </section>

      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}

      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Created</th>
                <th>Customer</th>
                <th>Type</th>
                <th>Status</th>
                <th>Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6}>Loading…</td></tr>
              ) : orders.length === 0 ? (
                <tr><td colSpan={6}>No orders</td></tr>
              ) : (
                orders.map((o) => (
                  <tr key={o._id}>
                    <td>{o.createdAt ? new Date(o.createdAt).toLocaleString() : '—'}</td>
                    <td>
                      <div>{o.pickup?.location?.name || o.dropoff?.name || o.customerName || '—'}</div>
                      <small>{o.email || o.userEmail || o.phone || ''}</small>
                    </td>
                    <td>{o.fulfillmentType || '—'}</td>
                    <td><span className={`badge status-${(o.status || '').toLowerCase()}`}>{o.status || '—'}</span></td>
                    <td>{cents(o.totalCents)}</td>
                    <td>
                      <button type="button" className="btn small" onClick={() => setSelected(o)}>
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <h2>Order detail</h2>
            <p className="muted">ID: {selected._id}</p>

            <div className="detail-grid">
              <div>
                <strong>Status</strong>
                <div className="row-gap">
                  <select
                    value={(selected.status || '').toLowerCase()}
                    onChange={(e) => changeStatus(selected._id, e.target.value)}
                  >
                    {!STATUS_OPTIONS.includes((selected.status || '').toLowerCase()) && (
                      <option value={(selected.status || '').toLowerCase()}>{selected.status}</option>
                    )}
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <strong>Fulfillment</strong>
                <p>{selected.fulfillmentType || '—'}</p>
              </div>
              <div>
                <strong>Total</strong>
                <p>{cents(selected.totalCents)}</p>
              </div>
              <div>
                <strong>Contact</strong>
                <p>{selected.email || selected.userEmail || '—'}</p>
                <p>{selected.phone || selected.pickup?.location?.phone || selected.dropoff?.phone || '—'}</p>
              </div>
            </div>

            <h3>Items</h3>
            <ul className="item-list">
              {(selected.items || []).length === 0 && <li>No items</li>}
              {(selected.items || []).map((item, idx) => (
                <li key={idx}>
                  {item.quantity || 1}× {item.name || 'Item'}
                  {item.size ? ` (${item.size})` : ''} — {cents(item.priceCents)}
                </li>
              ))}
            </ul>

            {selected.notes && (
              <>
                <h3>Notes</h3>
                <p>{selected.notes}</p>
              </>
            )}

            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setSelected(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
