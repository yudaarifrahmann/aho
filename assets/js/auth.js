// Shared authentication functions
const API_BASE_URL = 'https://absen.ahoservice.my.id';
const ADMIN_STORAGE_KEY = 'admin_data';
const TOKEN_KEY = 'admin_token';

// Check authentication on page load
document.addEventListener('DOMContentLoaded', () => {
    if (!localStorage.getItem(TOKEN_KEY) {
        // Redirect to login if not authenticated
        if (window.location.pathname !== '/index.html') {
            window.location.href = 'index.html';
        }
    } else if (window.location.pathname === '/index.html') {
        // Redirect to dashboard if already logged in
        window.location.href = 'dashboard.html';
    }

    // Setup login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
});

async function handleLogin(e) {
    e.preventDefault();
    const form = e.target;
    const username = form.username.value.trim();
    const password = form.password.value;
    
    if (!username || !password) {
        showToast('Username dan password harus diisi', 'error');
        return;
    }
    
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Memproses...';
    submitBtn.disabled = true;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.message || 'Login gagal');
        }
        
        // Save token and admin data
        localStorage.setItem(TOKEN_KEY, data.token || '');
        localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(data.admin || {}));
        
        // Redirect to dashboard
        window.location.href = 'dashboard.html';
        
    } catch (error) {
        console.error('Login error:', error);
        showToast(error.message || 'Gagal melakukan login', 'error');
    } finally {
        submitBtn.innerHTML = originalBtnText;
        submitBtn.disabled = false;
    }
}

function logout() {
    if (confirm('Apakah Anda yakin ingin logout?')) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(ADMIN_STORAGE_KEY);
        window.location.href = 'index.html';
    }
}

// Shared toast function
function showToast(message, type = 'success') {
    // Toast implementation same as before
    // ...
}