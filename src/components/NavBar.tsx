import { NavLink } from 'react-router-dom';

const ITEMS = [
  { to: '/', label: 'День', icon: '🍽' },
  { to: '/products', label: 'Справочник', icon: '📚' },
  { to: '/advice', label: 'Советы', icon: '💡' },
  { to: '/settings', label: 'Настройки', icon: '⚙️' },
];

export default function NavBar() {
  return (
    <nav className="navbar">
      {ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) => `nav-item ${isActive ? 'nav-item-active' : ''}`}
        >
          <span className="nav-icon">{item.icon}</span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
