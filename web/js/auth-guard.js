/**
 * ALTCHA Sentinel — Auth Guard
 * Include this on every protected manager page.
 * Enforces authentication, RBAC page restrictions, and role-based sidebar visibility.
 */
(function () {
  'use strict';

  const LOGIN_PAGE = './login';
  const KEYS_PAGE = './keys';
  const INTEGRATION_PAGE = './integration';

  const AUTH_CACHE_KEY = 'sentinel_auth_session';

  function getCachedAuth() {
    try {
      const raw = sessionStorage.getItem(AUTH_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function setCachedAuth(data) {
    try {
      sessionStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(data));
    } catch {}
  }

  function clearCachedAuth() {
    try {
      sessionStorage.removeItem(AUTH_CACHE_KEY);
    } catch {}
  }

  // Pre-seed from cache synchronously to prevent any sidebar flash or role flicker
  const initialCached = getCachedAuth();
  if (initialCached) {
    window.__authUser = initialCached.username || 'admin';
    window.__authRole = initialCached.role || 'administrator';
    window.__authFullName = initialCached.fullName || initialCached.username || 'Administrator';
  }

  function redirectToLogin() {
    clearCachedAuth();
    const p = window.location.pathname;
    if (!p.endsWith('/login') && !p.endsWith('login.html') && !p.endsWith('/login.html')) {
      window.location.replace(LOGIN_PAGE);
    }
  }

  function applyUserInfo() {
    const fullName = window.__authFullName || window.__authUser || 'Administrator';
    const username = window.__authUser || 'admin';
    const role = window.__authRole || 'user';
    const roleLabel = role === 'administrator' ? 'Administrator' : 'User';

    document.querySelectorAll('[data-auth-fullname]').forEach(function (el) {
      el.textContent = fullName;
    });
    document.querySelectorAll('[data-auth-username]').forEach(function (el) {
      el.textContent = username;
    });
    document.querySelectorAll('[data-auth-role]').forEach(function (el) {
      el.textContent = roleLabel;
    });
  }

  function applyUsername(username) {
    if (username) window.__authUser = username;
    applyUserInfo();
  }

  function applyRoleRestrictions(role) {
    const userRole = role || window.__authRole || (initialCached ? initialCached.role : 'administrator');
    
    if (userRole === 'user') {
      // 1. If non-admin user is on an admin-only page, redirect immediately to keys
      const currentPath = window.location.pathname;
      const isKeysPage = currentPath.endsWith('keys') || currentPath.endsWith('keys.html');
      const isIntegrationPage = currentPath.endsWith('integration') || currentPath.endsWith('integration.html');
      const isLoginPage = currentPath.endsWith('login') || currentPath.endsWith('login.html');

      if (!isKeysPage && !isIntegrationPage && !isLoginPage) {
        window.location.replace(KEYS_PAGE);
        return;
      }

      // 2. Hide all admin-only navigation elements in sidebar
      document.querySelectorAll('[data-role="admin-only"]').forEach(function (el) {
        el.classList.add('d-none');
      });

      // 3. Update brand logo link to point to integration
      document.querySelectorAll('a.brand-link').forEach(function (el) {
        el.setAttribute('href', INTEGRATION_PAGE);
      });
    } else if (userRole === 'administrator') {
      // 2. Ensure all admin-only navigation elements in sidebar are VISIBLE
      document.querySelectorAll('[data-role="admin-only"]').forEach(function (el) {
        el.classList.remove('d-none');
      });

      // 3. Update brand logo link to point to index
      document.querySelectorAll('a.brand-link').forEach(function (el) {
        el.setAttribute('href', './index');
      });
    }
  }

  // Immediately apply cached info if available
  applyUserInfo();
  if (window.__authRole) {
    applyRoleRestrictions(window.__authRole);
  }

  // Listen for template load completion to update username and role in sidebar/header
  document.addEventListener('templates:loaded', function () {
    applyUserInfo();
    if (window.__authRole) {
      applyRoleRestrictions(window.__authRole);
    }
  });

  document.addEventListener('DOMContentLoaded', function () {
    applyUserInfo();
    if (window.__authRole) {
      applyRoleRestrictions(window.__authRole);
    }
  });

  // Check session and role on page load
  fetch('/api/auth/me', { credentials: 'same-origin' })
    .then(function (res) {
      if (res.status === 401) {
        redirectToLogin();
      } else if (res.ok) {
        return res.json().then(function (data) {
          window.__authUser = data.username || 'admin';
          window.__authRole = data.role || 'user';
          window.__authFullName = data.full_name || data.fullName || data.username || 'Administrator';
          setCachedAuth({
            username: window.__authUser,
            role: window.__authRole,
            fullName: window.__authFullName
          });
          applyUserInfo();
          applyRoleRestrictions(window.__authRole);
        });
      } else {
        redirectToLogin();
      }
    })
    .catch(function () {
      // Keep running on transient network hiccup if cached
    });

  // Expose logout and auth helper globally
  window.AuthGuard = {
    getUser: function () {
      return window.__authUser || 'admin';
    },
    getFullName: function () {
      return window.__authFullName || window.__authUser || 'Administrator';
    },
    getRole: function () {
      return window.__authRole || 'user';
    },
    applyUserInfo: applyUserInfo,
    applyUsername: applyUsername,
    applyRoleRestrictions: applyRoleRestrictions,
    logout: function () {
      clearCachedAuth();
      try { sessionStorage.clear(); } catch(e) {}
      fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      }).finally(function () {
        window.location.replace(LOGIN_PAGE);
      });
    },

    showToast: function (message, type) {
      let container = document.getElementById('auth-toast-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'auth-toast-container';
        container.style.cssText = 'position: fixed; top: 1rem; right: 1rem; z-index: 10000; display: flex; flex-direction: column; gap: 0.5rem;';
        document.body.appendChild(container);
      }
      const colors = { success: '#198754', error: '#dc3545', info: '#0dcaf0', warning: '#ffc107' };
      const toast = document.createElement('div');
      toast.style.cssText = `background:${colors[type] || colors.info};color:#fff;padding:.6rem 1rem;border-radius:6px;font-size:.85rem;box-shadow:0 3px 10px rgba(0,0,0,.25);max-width:340px;`;
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(function () {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity .3s ease';
        setTimeout(function () { toast.remove(); }, 350);
      }, 3500);
    },

    togglePasswordVisibility: function (inputId) {
      const el = document.getElementById(inputId);
      if (!el) return;
      el.type = el.type === 'password' ? 'text' : 'password';
      const icon = el.parentElement.querySelector('i');
      if (icon) {
        if (el.type === 'text') {
          icon.classList.remove('bi-eye');
          icon.classList.add('bi-eye-slash');
        } else {
          icon.classList.remove('bi-eye-slash');
          icon.classList.add('bi-eye');
        }
      }
    },

    ensureChangePasswordModal: function () {
      if (document.getElementById('changePasswordModal')) return;

      const modalHtml = `
        <div class="modal fade" id="changePasswordModal" tabindex="-1" aria-labelledby="changePasswordModalLabel" aria-hidden="true">
          <div class="modal-dialog modal-dialog-centered modal-sm" style="max-width: 400px;">
            <div class="modal-content shadow">
              <form id="changePasswordForm" onsubmit="window.AuthGuard && window.AuthGuard.handleChangePasswordSubmit(event)">
                <div class="modal-header py-2 px-3">
                  <h5 class="modal-title fs-6" id="changePasswordModalLabel">
                    <i class="bi bi-key me-1 text-primary"></i> Change Password
                  </h5>
                  <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body p-3">
                  <div id="changePasswordAlert" class="alert alert-danger d-none py-2 mb-3" style="font-size: 0.85rem;"></div>

                  <div class="mb-3">
                    <label for="currentPasswordInput" class="form-label small text-secondary mb-1">Current Password <span class="text-danger">*</span></label>
                    <div class="input-group input-group-sm">
                      <span class="input-group-text"><i class="bi bi-lock"></i></span>
                      <input type="password" class="form-control" id="currentPasswordInput" placeholder="Enter current password" required autocomplete="current-password" />
                      <button class="btn btn-outline-secondary" type="button" onclick="window.AuthGuard && window.AuthGuard.togglePasswordVisibility('currentPasswordInput')" title="Show/Hide">
                        <i class="bi bi-eye"></i>
                      </button>
                    </div>
                  </div>

                  <div class="mb-3">
                    <label for="newPasswordInput" class="form-label small text-secondary mb-1">New Password <span class="text-danger">*</span></label>
                    <div class="input-group input-group-sm">
                      <span class="input-group-text"><i class="bi bi-shield-lock"></i></span>
                      <input type="password" class="form-control" id="newPasswordInput" placeholder="Minimum 6 characters" required autocomplete="new-password" />
                      <button class="btn btn-outline-secondary" type="button" onclick="window.AuthGuard && window.AuthGuard.togglePasswordVisibility('newPasswordInput')" title="Show/Hide">
                        <i class="bi bi-eye"></i>
                      </button>
                    </div>
                  </div>

                  <div class="mb-2">
                    <label for="confirmPasswordInput" class="form-label small text-secondary mb-1">Confirm New Password <span class="text-danger">*</span></label>
                    <div class="input-group input-group-sm">
                      <span class="input-group-text"><i class="bi bi-check-circle"></i></span>
                      <input type="password" class="form-control" id="confirmPasswordInput" placeholder="Re-enter new password" required autocomplete="new-password" />
                      <button class="btn btn-outline-secondary" type="button" onclick="window.AuthGuard && window.AuthGuard.togglePasswordVisibility('confirmPasswordInput')" title="Show/Hide">
                        <i class="bi bi-eye"></i>
                      </button>
                    </div>
                  </div>
                </div>
                <div class="modal-footer py-2 px-3">
                  <button type="button" class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Cancel</button>
                  <button type="submit" class="btn btn-sm btn-primary" id="btn-save-password">
                    <span id="btn-save-password-text">Update Password</span>
                    <span id="btn-save-password-spinner" class="spinner-border spinner-border-sm d-none ms-1"></span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      `;
      document.body.insertAdjacentHTML('beforeend', modalHtml);
    },

    openChangePasswordModal: function () {
      this.ensureChangePasswordModal();
      const alertEl = document.getElementById('changePasswordAlert');
      if (alertEl) {
        alertEl.classList.add('d-none');
        alertEl.textContent = '';
      }
      const form = document.getElementById('changePasswordForm');
      if (form) form.reset();

      const modalEl = document.getElementById('changePasswordModal');
      if (modalEl && window.bootstrap && window.bootstrap.Modal) {
        const modal = window.bootstrap.Modal.getInstance(modalEl) || new window.bootstrap.Modal(modalEl);
        modal.show();
      }
    },

    handleChangePasswordSubmit: async function (e) {
      e.preventDefault();
      const alertEl = document.getElementById('changePasswordAlert');
      if (alertEl) {
        alertEl.classList.add('d-none');
        alertEl.textContent = '';
      }

      const currentPassword = document.getElementById('currentPasswordInput').value;
      const newPassword = document.getElementById('newPasswordInput').value;
      const confirmPassword = document.getElementById('confirmPasswordInput').value;

      if (!currentPassword) {
        alertEl.textContent = 'Please enter your current password.';
        alertEl.classList.remove('d-none');
        return;
      }
      if (!newPassword || newPassword.length < 6) {
        alertEl.textContent = 'New password must be at least 6 characters long.';
        alertEl.classList.remove('d-none');
        return;
      }
      if (newPassword !== confirmPassword) {
        alertEl.textContent = 'New password and confirmation do not match.';
        alertEl.classList.remove('d-none');
        return;
      }

      const btn = document.getElementById('btn-save-password');
      const btnText = document.getElementById('btn-save-password-text');
      const spinner = document.getElementById('btn-save-password-spinner');

      btn.disabled = true;
      spinner.classList.remove('d-none');
      btnText.textContent = 'Updating';

      try {
        const res = await fetch('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            current_password: currentPassword,
            new_password: newPassword
          })
        });

        const data = await res.json().catch(function () { return {}; });
        if (res.ok && data.success) {
          const modalEl = document.getElementById('changePasswordModal');
          if (modalEl && window.bootstrap && window.bootstrap.Modal) {
            const modal = window.bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();
          }
          window.AuthGuard.showToast(data.message || 'Password has been changed successfully!', 'success');
          document.getElementById('changePasswordForm').reset();
        } else {
          alertEl.textContent = data.error || 'Failed to update password. Please check your current password.';
          alertEl.classList.remove('d-none');
        }
      } catch (err) {
        alertEl.textContent = 'Network or server error. Please try again.';
        alertEl.classList.remove('d-none');
      } finally {
        btn.disabled = false;
        spinner.classList.add('d-none');
        btnText.textContent = 'Update Password';
      }
    }
  };
})();
