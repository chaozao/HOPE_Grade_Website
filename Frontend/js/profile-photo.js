// Own-account photos shared by every sidebar and both profile screens.
window.ProfilePhoto = (function () {
  let photoUrl = '', viewer, fullImage, viewport, zoomLabel, zoom = 1, fitWidth = 0;
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function fallback(target) {
    const icon = node('i');
    icon.className = getPayload(getToken() || '')?.role === 'admin'
      ? 'bi bi-shield-lock-fill' : 'bi bi-person-fill';
    target.replaceChildren(icon);
  }
  function render(path) {
    photoUrl = path ? new URL(path, API_BASE_URL).href : '';
    document.querySelectorAll('.user-avatar, #avatar-preview').forEach((target) => {
      const preview = target.id === 'avatar-preview';
      if (preview) {
        target.disabled = !photoUrl;
        target.title = photoUrl ? 'View and zoom your profile photo' : 'Upload a profile photo first';
      }
      if (!photoUrl) { fallback(target); return; }
      const img = node('img');
      img.src = photoUrl;
      img.alt = 'Your profile photo';
      img.addEventListener('error', () => {
        if (target.querySelector('img') !== img) return;
        fallback(target);
        if (preview) { target.disabled = true; target.title = 'Profile photo could not be loaded.'; }
      });
      target.replaceChildren(img);
    });
    if (viewer?.open) viewer.close();
  }
  function setZoom(value) {
    zoom = Math.max(0.5, Math.min(4, value));
    fullImage.style.width = fitWidth * zoom + 'px';
    fullImage.style.height = fitWidth * zoom + 'px';
    zoomLabel.textContent = Math.round(zoom * 100) + '%';
    viewer.querySelector('[data-zoom="out"]').disabled = zoom === 0.5;
    viewer.querySelector('[data-zoom="in"]').disabled = zoom === 4;
  }
  function fit() {
    if (!fullImage.naturalWidth) return;
    // Enlarge small uploads too; keep the same circular crop as the avatar.
    fitWidth = Math.max(1, Math.min(560, viewport.clientWidth - 24, viewport.clientHeight - 24));
    setZoom(1);
    viewport.scrollTop = viewport.scrollLeft = 0;
  }
  function open() {
    if (!photoUrl) return;
    if (!viewer) {
      viewer = node('dialog', '', 'profile-photo-viewer');
      viewer.setAttribute('aria-labelledby', 'profile-photo-viewer-title');
      const title = node('h2', 'Your profile photo');
      title.id = 'profile-photo-viewer-title';
      const controls = node('div', '', 'profile-photo-controls');
      function button(text, action, zoomAction) {
        const element = node('button', text);
        element.type = 'button';
        if (zoomAction) element.dataset.zoom = zoomAction;
        element.addEventListener('click', action);
        controls.appendChild(element);
      }
      button('Zoom out', () => setZoom(zoom - 0.25), 'out');
      button('Zoom in', () => setZoom(zoom + 0.25), 'in');
      button('Fit', fit);
      zoomLabel = node('span', '100%');
      zoomLabel.setAttribute('role', 'status');
      controls.appendChild(zoomLabel);
      button('Close', () => viewer.close());
      viewport = node('div', '', 'profile-photo-viewport');
      viewport.tabIndex = 0;
      viewport.setAttribute('aria-label', 'Circular profile photo. Scroll to explore when zoomed in.');
      fullImage = node('img');
      fullImage.alt = 'Your enlarged profile photo';
      fullImage.addEventListener('load', fit);
      fullImage.addEventListener('error', () => { zoomLabel.textContent = 'Photo could not be loaded.'; });
      viewport.appendChild(fullImage);
      viewer.append(title, viewport, controls);
      viewer.addEventListener('click', (event) => {
        const bounds = viewer.getBoundingClientRect();
        if (event.target === viewport || (event.target === viewer && (event.clientX < bounds.left || event.clientX > bounds.right ||
            event.clientY < bounds.top || event.clientY > bounds.bottom))) viewer.close();
      });
      window.addEventListener('resize', () => { if (viewer.open) fit(); });
      document.body.appendChild(viewer);
    }
    fullImage.src = photoUrl;
    viewer.showModal();
    fit();
  }
  document.addEventListener('DOMContentLoaded', async () => {
    const preview = document.getElementById('avatar-preview');
    if (preview) {
      preview.addEventListener('click', open);
      // These pages already load /me and call render after loading or uploading.
      return;
    }
    const token = getToken();
    if (!token || !document.querySelector('.user-avatar')) return;
    try {
      const response = await fetch(API_BASE_URL + '/me', { headers: { Authorization: 'Bearer ' + token } });
      if (!response.ok || getToken() !== token) return;
      const user = await response.json();
      if (getToken() === token) render(user.photo);
    } catch (_) {
      // Keep the default icon if the profile request is unavailable.
    }
  });
  return { render, open };
})();
