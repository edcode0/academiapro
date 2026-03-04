const fs = require('fs');
const cssPath = 'public/glassmorphism.css';
let cssDec = fs.readFileSync(cssPath, 'utf8');

const regexToReplace = /aside a,\s*\.sidebar a,\s*#sidebar a\s*\{[\s\S]*?color: #6366f1 !important;\s*\}/;

const newStyles = `
/* SIDEBAR NAV BUTTONS - UIverse animation */
.sidebar a, .sidebar nav a, aside a, nav.sidebar a, #sidebar a {
  --color: #6366f1;
  display: flex !important;
  align-items: center !important;
  gap: 0.75rem !important;
  padding: 0.75rem 1rem !important;
  margin: 4px 8px !important;
  position: relative !important;
  cursor: pointer !important;
  overflow: hidden !important;
  border: 1px solid transparent !important;
  transition: color 0.5s !important;
  z-index: 1 !important;
  font-size: 0.95rem !important;
  border-radius: 8px !important;
  font-weight: 500 !important;
  color: #475569 !important;
  text-decoration: none !important;
  background: transparent !important;
}

.sidebar a:before, aside a:before, #sidebar a:before {
  content: "" !important;
  position: absolute !important;
  z-index: -1 !important;
  background: var(--color) !important;
  height: 200px !important;
  width: 250px !important;
  border-radius: 50% !important;
  top: 100% !important;
  left: 100% !important;
  transition: all 0.7s !important;
}

.sidebar a:hover, aside a:hover, #sidebar a:hover {
  color: #fff !important;
  border-color: rgba(99, 102, 241, 0.3) !important;
  background: transparent !important;
}

.sidebar a:hover:before, aside a:hover:before, #sidebar a:hover:before {
  top: -50px !important;
  left: -50px !important;
}

.sidebar a:active:before, aside a:active:before, #sidebar a:active:before {
  background: #4f46e5 !important;
  transition: background 0s !important;
}

/* Active link */
.sidebar a.active, aside a.active, #sidebar a.active, .sidebar .active, aside .active {
  color: #6366f1 !important;
  background: rgba(99, 102, 241, 0.08) !important;
  border: 1px solid rgba(99, 102, 241, 0.2) !important;
}

.sidebar a.active:before, aside a.active:before, #sidebar a.active:before, .sidebar .active:before, aside .active:before {
  display: none !important;
}

.sidebar a.active:hover, aside a.active:hover, #sidebar a.active:hover, .sidebar .active:hover, aside .active:hover {
  color: #fff !important;
}

.sidebar a.active:hover:before, aside a.active:hover:before, #sidebar a.active:hover:before, .sidebar .active:hover:before, aside .active:hover:before {
  display: block !important;
  top: -50px !important;
  left: -50px !important;
}
`;

cssDec = cssDec.replace(regexToReplace, newStyles.trim());
fs.writeFileSync(cssPath, cssDec, 'utf8');
console.log("Updated glassmorphism.css");
