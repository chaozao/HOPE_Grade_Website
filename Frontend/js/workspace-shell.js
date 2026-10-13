// Runs in the head, before the browser can paint a role-specific menu.
document.documentElement.classList.add('workspace-pending');
const workspaceStyle = document.createElement('style');
workspaceStyle.textContent = `
  .workspace-pending .sidebar-nav, .workspace-pending .user-role { visibility: hidden; }
  .workspace-pending[data-workspace-dashboard] .dashboard,
  .workspace-pending[data-workspace-dashboard] .sidebar-toggle { visibility: hidden; }
  .workspace-load-state { display: none; }
  .workspace-pending .workspace-load-state { display: block; position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 200; padding: 12px 20px; border-radius: 8px; background: #fff; color: #243c3c; box-shadow: 0 2px 12px #0002; font: 14px/1.5 sans-serif; }
`;
document.head.appendChild(workspaceStyle);
if (location.pathname.endsWith('/dashboard.html')) document.documentElement.dataset.workspaceDashboard = '';
document.addEventListener('DOMContentLoaded', function () {
    const status = document.createElement('div');
    status.className = 'workspace-load-state';
    status.setAttribute('role', 'status');
    status.append('Loading your workspace… ');
    const retry = document.createElement('button');
    retry.type = 'button'; retry.textContent = 'Retry';
    retry.addEventListener('click', () => location.reload());
    status.appendChild(retry); document.body.appendChild(status);
});
