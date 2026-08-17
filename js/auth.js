// ---- Login / account handling ----
const Auth = {
    async status() {
        const res = await fetch('api/auth.php');
        if (!res.ok) throw new Error('API error ' + res.status);
        return res.json();
    },
    async login(username, password) {
        const res = await fetch('api/auth.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'login', username, password }),
        });
        return res.json();
    },
    async register(username, password) {
        const res = await fetch('api/auth.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'register', username, password }),
        });
        return res.json();
    },
    async logout() {
        const res = await fetch('api/auth.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'logout' }),
        });
        return res.json();
    },
};

async function requireLogin(redirectTo) {
    try {
        const st = await Auth.status();
        if (st.ok && st.user) {
            const chip = document.getElementById('userChip');
            if (chip) chip.textContent = st.user;
            return st.user;
        }
    } catch (e) { /* fall through to redirect */ }
    window.location.replace(redirectTo || 'login.html');
    return null;
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
        await Auth.logout();
        window.location.replace('login.html');
    });
});