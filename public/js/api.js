/**
 * REST API client for Teen Patti
 */
const API = {
  async register(username, password, avatar) {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, avatar })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Registration failed');
    }
    return data;
  },

  async login(username, password) {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Login failed');
    }
    return data;
  },

  async getMe(userId) {
    const res = await fetch(`/api/me/${userId}`);
    return res.json();
  },

  async refill(userId) {
    const res = await fetch('/api/refill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId })
    });
    return res.json();
  },

  async getAdminUsers(masterId) {
    const res = await fetch(`/api/admin/users?masterId=${encodeURIComponent(masterId || '')}`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to fetch users');
    }
    return data;
  },

  async getAdminTables(masterId) {
    const res = await fetch(`/api/admin/tables?masterId=${encodeURIComponent(masterId || '')}`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to fetch admin tables');
    }
    return data;
  },

  async masterManageChips(masterId, targetUserId, amount, action) {
    const res = await fetch('/api/admin/chips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ masterId, targetUserId, amount, action })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to update user chips');
    }
    return data;
  },

  async masterBulkResetZero(masterId) {
    const res = await fetch('/api/admin/bulk-reset-zero', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ masterId })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to reset user chips');
    }
    return data;
  },

  async masterBulkAddChips(masterId, amount = 2000000) {
    const res = await fetch('/api/admin/bulk-add-chips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ masterId, amount })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to bulk add chips');
    }
    return data;
  },

  async tipDealer(userId, tipAmount) {
    const res = await fetch('/api/table/tip-dealer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, tipAmount })
    });
    return res.json();
  },

  async getTables() {
    const res = await fetch('/api/tables');
    return res.json();
  },

  async createTable(name, bootAmount, potLimit, isPrivate, variation = 'classic', maxPlayers = 10, ownerId = null, ownerName = null) {
    const res = await fetch('/api/tables/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, bootAmount, potLimit, isPrivate, variation, maxPlayers, ownerId, ownerName })
    });
    return res.json();
  },

  async joinCode(code) {
    const res = await fetch('/api/tables/join-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    return res.json();
  }
};

window.API = API;
