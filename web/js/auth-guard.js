/**
 * ALTCHA Sentinel — Auth Guard
 * Include this on every protected manager page.
 * Enforces authentication, RBAC page restrictions, and role-based sidebar visibility.
 */
(function () {
  'use strict';

  const LOGIN_PAGE = './login';
  const KEYS_PAGE = './keys';

  function redirectToLogin() {
    const p = window.location.pathname;
    if (!p.endsWith('/login') && !p.endsWith('login.html') && !p.endsWith('/login.html')) {
      window.location.replace(LOGIN_PAGE);
    }
  }

  function applyUsername(username) {
    const name = username || window.__authUser || 'admin';
    document.querySelectorAll('[data-auth-username]').forEach(function (el) {
      el.textContent = name;
    });
  }

  function applyRoleRestrictions(role) {
    const userRole = role || window.__authRole || 'user';
    
    if (userRole === 'user') {
      // 1. If non-admin user is on an admin-only page, redirect immediately to keys
      const currentPath = window.location.pathname;
      const isKeysPage = currentPath.endsWith('keys') || currentPath.endsWith('keys.html');
      const isLoginPage = currentPath.endsWith('login') || currentPath.endsWith('login.html');

      if (!isKeysPage && !isLoginPage) {
        window.location.replace(KEYS_PAGE);
        return;
      }

      // 2. Hide all admin-only navigation elements in sidebar
      document.querySelectorAll('[data-role="admin-only"]').forEach(function (el) {
        el.classList.add('d-none');
      });

      // 3. Update brand logo link to point to keys
      document.querySelectorAll('a.brand-link').forEach(function (el) {
        el.setAttribute('href', KEYS_PAGE);
      });
    }
  }

  // Listen for template load completion to update username and role in sidebar/header
  document.addEventListener('templates:loaded', function () {
    if (window.__authUser) {
      applyUsername(window.__authUser);
    }
    if (window.__authRole) {
      applyRoleRestrictions(window.__authRole);
    }
  });

  document.addEventListener('DOMContentLoaded', function () {
    if (window.__authUser) {
      applyUsername(window.__authUser);
    }
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
          applyUsername(window.__authUser);
          applyRoleRestrictions(window.__authRole);
        });
      } else {
        redirectToLogin();
      }
    })
    .catch(function () {
      redirectToLogin();
    });

  // Expose logout and auth helper globally
  window.AuthGuard = {
    getUser: function () {
      return window.__authUser || 'admin';
    },
    getRole: function () {
      return window.__authRole || 'user';
    },
    applyUsername: applyUsername,
    applyRoleRestrictions: applyRoleRestrictions,
    logout: function () {
      fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      }).finally(function () {
        window.location.replace(LOGIN_PAGE);
      });
    },
  };
})();
