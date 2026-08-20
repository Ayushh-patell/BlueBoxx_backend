import { NavLink, Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const { isAuthenticated, user, logout, adminSecret } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">BB</span>
          <div>
            <strong>BlueBoxx</strong>
            <p>Admin</p>
          </div>
        </div>

        <nav className="nav">
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/users">Users</NavLink>
          <NavLink to="/orders">Orders</NavLink>
        </nav>

        <div className="sidebar-footer">
          <div className="session">
            <span>{user?.username || 'Admin'}</span>
            {!adminSecret && <em className="warn">No admin secret</em>}
          </div>
          <button type="button" className="btn ghost" onClick={logout}>
            Log out
          </button>
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
