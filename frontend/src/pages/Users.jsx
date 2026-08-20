import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const emptyForm = {
  username: '',
  name: '',
  site: '',
  temp_Password: 'BlueBoxxNewUser',
  premium: false,
};

export default function Users() {
  const { adminSecret, saveAdminSecret } = useAuth();
  const [users, setUsers] = useState([]);
  const [sites, setSites] = useState([]);
  const [query, setQuery] = useState('');
  const [siteFilter, setSiteFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [secretInput, setSecretInput] = useState(adminSecret || '');

  async function loadUsers() {
    setLoading(true);
    setError('');
    try {
      const data = await api.listUsers({
        q: query.trim() || undefined,
        site: siteFilter || undefined,
      });
      setUsers(data.users || []);
    } catch (err) {
      setError(err.message || 'Failed to load users');
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    api.listSites()
      .then((data) => setSites(data.sites || []))
      .catch(() => setSites([]));
  }, []);

  useEffect(() => {
    if (adminSecret) loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminSecret]);

  function onChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function onCreate(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await api.createUser({
        username: form.username.trim(),
        name: form.name.trim(),
        site: form.site.trim(),
        temp_Password: form.temp_Password || 'BlueBoxxNewUser',
        premium: !!form.premium,
      });
      setMessage(`Created user ${form.username}`);
      setForm(emptyForm);
      await loadUsers();
    } catch (err) {
      setError(err.message || 'Create failed');
    }
  }

  function startEdit(user) {
    setEditing({
      userId: user._id,
      username: user.username,
      name: user.name || '',
      site: user.site || '',
      premium: !!user.premium,
      recovery_email: user.recovery_email || '',
      temp_password: '',
      resetPassword: false,
    });
    setMessage('');
    setError('');
  }

  async function onUpdate(e) {
    e.preventDefault();
    if (!editing) return;
    setError('');
    setMessage('');
    try {
      const payload = {
        userId: editing.userId,
        name: editing.name.trim(),
        site: editing.site.trim(),
        premium: !!editing.premium,
        recovery_email: editing.recovery_email.trim() || null,
        resetPassword: !!editing.resetPassword,
      };
      if (editing.temp_password.trim()) {
        payload.temp_password = editing.temp_password.trim();
      }
      await api.updateUser(payload);
      setMessage(`Updated ${editing.username}`);
      setEditing(null);
      await loadUsers();
    } catch (err) {
      setError(err.message || 'Update failed');
    }
  }

  function saveSecret(e) {
    e.preventDefault();
    saveAdminSecret(secretInput.trim());
    setMessage('Admin secret saved');
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Users</h1>
          <p>Create, search, and update app users.</p>
        </div>
        <button type="button" className="btn" onClick={loadUsers} disabled={!adminSecret || loading}>
          Refresh
        </button>
      </header>

      {!adminSecret && (
        <form className="panel inline-form" onSubmit={saveSecret}>
          <p>Enter the admin secret (`CREATE_USER_SECRET`) to manage users.</p>
          <input
            type="password"
            value={secretInput}
            onChange={(e) => setSecretInput(e.target.value)}
            placeholder="Admin secret"
            required
          />
          <button className="btn primary" type="submit">Save secret</button>
        </form>
      )}

      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}

      <section className="panel">
        <h2>Create user</h2>
        <form className="form-grid" onSubmit={onCreate}>
          <label>
            Username
            <input value={form.username} onChange={(e) => onChange('username', e.target.value)} required />
          </label>
          <label>
            Name
            <input value={form.name} onChange={(e) => onChange('name', e.target.value)} required />
          </label>
          <label>
            Site
            <input
              list="site-options"
              value={form.site}
              onChange={(e) => onChange('site', e.target.value)}
              required
              placeholder="site slug"
            />
          </label>
          <label>
            Temp password
            <input
              value={form.temp_Password}
              onChange={(e) => onChange('temp_Password', e.target.value)}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.premium}
              onChange={(e) => onChange('premium', e.target.checked)}
            />
            Premium
          </label>
          <button className="btn primary" type="submit" disabled={!adminSecret}>
            Create
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="toolbar">
          <h2>All users ({users.length})</h2>
          <div className="filters">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name / username"
            />
            <select value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
              <option value="">All sites</option>
              {sites.map((s) => (
                <option key={s._id || s.slug} value={s.slug}>
                  {s.name || s.slug}
                </option>
              ))}
            </select>
            <button type="button" className="btn" onClick={loadUsers} disabled={!adminSecret}>
              Search
            </button>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Name</th>
                <th>Site</th>
                <th>Premium</th>
                <th>Password</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6}>Loading…</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={6}>No users found</td></tr>
              ) : (
                users.map((u) => (
                  <tr key={u._id}>
                    <td>{u.username}</td>
                    <td>{u.name}</td>
                    <td>{u.site}</td>
                    <td>{u.premium ? 'Yes' : 'No'}</td>
                    <td>{u.hasPassword ? 'Set' : `Temp: ${u.temp_password || '—'}`}</td>
                    <td>
                      <button type="button" className="btn small" onClick={() => startEdit(u)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <datalist id="site-options">
        {sites.map((s) => (
          <option key={s._id || s.slug} value={s.slug}>{s.name || s.slug}</option>
        ))}
      </datalist>

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={onUpdate}>
            <h2>Edit {editing.username}</h2>
            <label>
              Name
              <input
                value={editing.name}
                onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))}
                required
              />
            </label>
            <label>
              Site
              <input
                list="site-options"
                value={editing.site}
                onChange={(e) => setEditing((p) => ({ ...p, site: e.target.value }))}
                required
              />
            </label>
            <label>
              Recovery email
              <input
                value={editing.recovery_email}
                onChange={(e) => setEditing((p) => ({ ...p, recovery_email: e.target.value }))}
              />
            </label>
            <label>
              New temp password
              <input
                value={editing.temp_password}
                onChange={(e) => setEditing((p) => ({ ...p, temp_password: e.target.value }))}
                placeholder="Leave blank to keep"
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={editing.premium}
                onChange={(e) => setEditing((p) => ({ ...p, premium: e.target.checked }))}
              />
              Premium
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={editing.resetPassword}
                onChange={(e) => setEditing((p) => ({ ...p, resetPassword: e.target.checked }))}
              />
              Reset password (force temp login)
            </label>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="submit" className="btn primary">Save</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
